import { ActionType } from '@/types/types';

export type RiskLevel = 'low' | 'medium' | 'high' | 'forbidden';
export type SafetyDecision = 'allow' | 'warn' | 'block';

export interface SafetyEvaluation {
  risk_level: RiskLevel;
  decision: SafetyDecision;
  reason: string;
  matched_rule: string;
}

export async function evaluateSafetyGate(params: {
  action_type: string;
  target_selector: string | null;
  input_value: string | null;
}): Promise<SafetyEvaluation> {
  const { action_type, target_selector, input_value } = params;
  
  const textToAnalyze = `${action_type} ${target_selector || ''} ${input_value || ''}`.toLowerCase();

  // Rules matching
  const forbiddenKeywords = ['drop table', 'rm -rf', 'delete_account', 'bypass_auth'];
  for (const kw of forbiddenKeywords) {
    if (textToAnalyze.includes(kw)) {
      return {
        risk_level: 'forbidden',
        decision: 'block',
        reason: `Matched forbidden keyword: ${kw}`,
        matched_rule: 'forbidden_keyword',
      };
    }
  }

  const highKeywords = ['delete', 'remove', 'pay', 'purchase', 'transfer', 'authorize'];
  for (const kw of highKeywords) {
    if (textToAnalyze.includes(kw)) {
      return {
        risk_level: 'high',
        decision: 'block',
        reason: `Matched high-risk keyword: ${kw}`,
        matched_rule: 'high_risk_keyword',
      };
    }
  }

  const mediumKeywords = ['submit', 'login', 'send', 'save', 'update', 'confirm'];
  for (const kw of mediumKeywords) {
    if (textToAnalyze.includes(kw)) {
      return {
        risk_level: 'medium',
        decision: 'warn',
        reason: `Matched medium-risk keyword: ${kw}`,
        matched_rule: 'medium_risk_keyword',
      };
    }
  }

  return {
    risk_level: 'low',
    decision: 'allow',
    reason: 'No risky patterns detected',
    matched_rule: 'default_allow',
  };
}
