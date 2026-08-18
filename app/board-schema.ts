export type BoardMode = "before" | "after";
export type BoardStatus = "idle" | "running" | "success" | "error" | "blocked";
export type BoardNodeKind = "client" | "rules" | "database" | "service";
export type BoardEdgeSemantic = "request" | "query" | "response" | "error";
export type BoardCategoryIcon =
  | "web-app"
  | "mobile-app"
  | "api"
  | "database"
  | "auth"
  | "storage"
  | "compute"
  | "payment"
  | "analytics"
  | "messaging"
  | "network"
  | "security"
  | "cloud"
  | "queue"
  | "webhook"
  | "ai"
  | "service";

export type BoardNodeConfig = {
  id: string;
  title: string;
  subtitle: string;
  detail: string;
  kind: BoardNodeKind;
  logo?: string;
  categoryIcon?: BoardCategoryIcon;
  changed?: boolean;
};

export type BoardEdgeConfig = {
  id: string;
  source: string;
  target: string;
  direction: "forward" | "return";
  label: string;
  semantic: BoardEdgeSemantic;
  activeSteps: number[];
  muted?: boolean;
};

export type BoardStepConfig = {
  title: string;
  reason: string;
  note: string;
  nodeStatuses: Record<string, BoardStatus>;
};

export type BoardFlowConfig = {
  id: BoardMode;
  label: string;
  outcome: "error" | "success";
  position: { x: number; y: number };
  nodes: BoardNodeConfig[];
  edges: BoardEdgeConfig[];
  steps: BoardStepConfig[];
};

export type BoardConfig = {
  version: 1;
  title: string;
  flows: [BoardFlowConfig, BoardFlowConfig];
};
