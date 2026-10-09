export type RoutingStrategy = 'direct' | 'fallback-cascade' | 'routellm-pareto' | 'intent-heuristic';

export interface RouteTarget {
  provider: string;
  model: string;
  weight?: number;
}

export interface RoutingDecision {
  targetProvider: string;
  targetModel: string;
  reason: string;
  strategy: RoutingStrategy;
  cascadeChain: RouteTarget[];
  score?: number;
  routedViaRouteLlm?: boolean;
}

export interface RouteLlmConfig {
  strongModel: RouteTarget;
  weakModel: RouteTarget;
  threshold: number; // 0.0 (weakest/cheapest) to 1.0 (strongest/frontier)
}

export interface FallbackRouteDefinition {
  primary: RouteTarget;
  fallbacks: RouteTarget[];
  onStatusCodes?: number[];
}

export interface RouterStats {
  totalRouted: number;
  strongModelCount: number;
  weakModelCount: number;
  fallbacksTriggered: number;
  costSavingsEstimatedPercent: number;
}
