export type BoardMode = "before" | "after";
export type BoardStatus = "idle" | "running" | "success" | "error" | "blocked";
export type BoardNodeKind = "client" | "rules" | "database" | "service" | "screen";
export type BoardScreenFrame = "browser" | "mobile" | "app";
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
  position?: { x: number; y: number };
  kind: BoardNodeKind;
  logo?: string;
  categoryIcon?: BoardCategoryIcon;
  screenshot?: string;
  frame?: BoardScreenFrame;
  route?: string;
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
  labelPosition?: { x: number; y: number };
  playbackPosition?: { x: number; y: number };
  nodes: BoardNodeConfig[];
  edges: BoardEdgeConfig[];
  steps: BoardStepConfig[];
};

export type BoardCanvasItemConfig = {
  id: string;
  type: "text" | "note" | "shape";
  position: { x: number; y: number };
  text: string;
};

export type BoardCanvasEdgeConfig = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export type BoardConfig = {
  version: 1 | 2 | 3;
  title: string;
  flows: [BoardFlowConfig, BoardFlowConfig];
  canvas?: {
    items: BoardCanvasItemConfig[];
    edges: BoardCanvasEdgeConfig[];
  };
};
