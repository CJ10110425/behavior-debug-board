"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction } from "react";
import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Panel,
  Position,
  ReactFlow,
  getStraightPath,
  useNodesState,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type Connection,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import boardConfigJson from "./board.generated.json";
import type {
  BoardConfig,
  BoardCategoryIcon,
  BoardEdgeSemantic,
  BoardFlowConfig,
  BoardMode,
  BoardNodeKind,
  BoardStatus,
} from "./board-schema";

type Mode = BoardMode;
type NodeStatus = BoardStatus;
type CanvasTool = "select" | "pan" | "connect" | "text" | "note" | "shape";
type IconName =
  | "check"
  | "x"
  | "play"
  | "pause"
  | "replay"
  | "zoom-in"
  | "zoom-out"
  | "fit"
  | "move"
  | "grip"
  | "select"
  | "pan"
  | "connect"
  | "text"
  | "note"
  | "shape"
  | "collapse";

type FlowRuntime = {
  step: number;
  playing: boolean;
};

type GroupData = { mode: Mode };
type LabelData = { mode: Mode; value: string };
type DebugNodeData = {
  mode: Mode;
  nodeId: string;
  title: string;
  subtitle: string;
  kind: BoardNodeKind;
  logo?: string;
  categoryIcon?: BoardCategoryIcon;
  status: NodeStatus;
  changed?: boolean;
  detail: string;
};
type PlaybackData = {
  mode: Mode;
  title: string;
  note: string;
  step: number;
  total: number;
  playing: boolean;
  finished: boolean;
  reason: string;
  onToggle: () => void;
  onReplay: () => void;
  onSeek: (step: number) => void;
};
type FreeTextData = { text: string };
type NoteData = { text: string };
type ShapeData = { text: string };

type FlowGroupNode = Node<GroupData, "flowGroup">;
type LabelNode = Node<LabelData, "labelNode">;
type DebugNode = Node<DebugNodeData, "debugNode">;
type PlaybackNode = Node<PlaybackData, "playbackNode">;
type FreeTextNode = Node<FreeTextData, "freeTextNode">;
type NoteNode = Node<NoteData, "noteNode">;
type ShapeNode = Node<ShapeData, "shapeNode">;
type CanvasNode = FlowGroupNode | LabelNode | DebugNode | PlaybackNode | FreeTextNode | NoteNode | ShapeNode;

type PacketData = {
  active?: boolean;
  color?: string;
  label?: string;
  labelOffset?: number;
  duration?: number;
  muted?: boolean;
  packetKind?: BoardEdgeSemantic;
};
type PacketEdge = Edge<PacketData, "packetEdge">;

type PlaybackActions = {
  onToggle: () => void;
  onReplay: () => void;
  onSeek: (step: number) => void;
};

type LoadedBoard = {
  config: BoardConfig;
  configHash: string;
  finalStep: boolean;
  initialFlow: Mode;
  timeScale: number;
};

type FlowConfigByMode = Record<Mode, BoardFlowConfig>;

const embeddedBoardConfig = boardConfigJson as BoardConfig;
const renderProtocol = "1";

const categoryIconPath: Record<BoardCategoryIcon, string> = {
  "web-app": "/icons/app-window.svg",
  "mobile-app": "/icons/smartphone.svg",
  api: "/icons/braces.svg",
  database: "/icons/database.svg",
  auth: "/icons/key-round.svg",
  storage: "/icons/hard-drive.svg",
  compute: "/icons/server.svg",
  payment: "/icons/credit-card.svg",
  analytics: "/icons/chart-no-axes-column-increasing.svg",
  messaging: "/icons/message-square.svg",
  network: "/icons/network.svg",
  security: "/icons/shield-check.svg",
  cloud: "/icons/cloud.svg",
  queue: "/icons/workflow.svg",
  webhook: "/icons/webhook.svg",
  ai: "/icons/bot.svg",
  service: "/icons/boxes.svg",
};

const defaultCategoryIcon: Record<BoardNodeKind, BoardCategoryIcon> = {
  client: "web-app",
  rules: "security",
  database: "database",
  service: "service",
};

const statusLabel: Record<NodeStatus, string> = {
  idle: "等待中",
  running: "傳輸中",
  success: "已通過",
  error: "被拒絕",
  blocked: "未抵達",
};

const iconPath: Record<IconName, string> = {
  check: "/icons/check.svg",
  x: "/icons/x.svg",
  play: "/icons/play.svg",
  pause: "/icons/pause.svg",
  replay: "/icons/rotate-ccw.svg",
  "zoom-in": "/icons/zoom-in.svg",
  "zoom-out": "/icons/zoom-out.svg",
  fit: "/icons/scan.svg",
  move: "/icons/move.svg",
  grip: "/icons/grip.svg",
  select: "/icons/mouse-pointer.svg",
  pan: "/icons/hand.svg",
  connect: "/icons/arrow-up-right.svg",
  text: "/icons/type.svg",
  note: "/icons/sticky-note.svg",
  shape: "/icons/square.svg",
  collapse: "/icons/chevron-down.svg",
};

function SvgIcon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <span
      className={`svg-icon svg-icon--${name}`}
      style={{ width: size, height: size, maskImage: `url(${iconPath[name]})`, WebkitMaskImage: `url(${iconPath[name]})` }}
      aria-hidden="true"
    />
  );
}

function ServiceIcon({ data }: { data: DebugNodeData }) {
  if (data.logo) {
    // Raw local SVGs preserve the exact brand asset and do not need responsive image optimization.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={`service-logo service-logo--${data.kind}`} src={data.logo} alt="" aria-hidden="true" />;
  }

  const category = data.categoryIcon ?? defaultCategoryIcon[data.kind];
  // Category icons are local Lucide assets used only when no trustworthy brand logo exists.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="category-icon" src={categoryIconPath[category]} alt="" aria-hidden="true" />;
}

function FlowGroupCard({ data, selected }: NodeProps<FlowGroupNode>) {
  return (
    <div className={`flow-group-frame flow-group-frame--${data.mode}${selected ? " is-selected" : ""}`}>
      <span className="group-move-indicator" title="拖曳空白處可移動整組 Flow">
        <SvgIcon name="move" size={16} />
      </span>
    </div>
  );
}

function TextLabelCard({ data }: NodeProps<LabelNode>) {
  return (
    <label className={`text-label-card text-label-card--${data.mode}`}>
      <SvgIcon name="grip" size={14} />
      <input
        className="nodrag nowheel nopan"
        defaultValue={data.value}
        aria-label={`${data.mode} flow label`}
        onKeyDown={(event) => event.stopPropagation()}
      />
    </label>
  );
}

function DebugNodeCard({ data }: NodeProps<DebugNode>) {
  return (
    <div
      className={`debug-node debug-node--${data.kind} debug-node--${data.status}`}
      data-testid="service-node"
      data-flow={data.mode}
      data-node-id={data.nodeId}
      data-status={data.status}
    >
      <Handle id="forward-in" type="target" position={Position.Left} className="debug-handle" style={{ top: "42%" }} />
      <Handle id="return-out" type="source" position={Position.Left} className="debug-handle" style={{ top: "72%" }} />
      <div className="debug-node__topline">
        <div className="debug-node__icon"><ServiceIcon data={data} /></div>
        <span className={`node-status node-status--${data.status}`} aria-live="polite">
          {data.status === "running"
            ? <span className="node-status__spinner" aria-hidden="true" />
            : <span className="node-status__dot" />}
          {statusLabel[data.status]}
        </span>
      </div>
      <div className="debug-node__body">
        <strong>{data.title}</strong>
        <span>{data.subtitle}</span>
      </div>
      <div className="debug-node__detail">
        {data.changed ? <span className="changed-badge">修改位置</span> : null}
        <span>{data.detail}</span>
      </div>
      <Handle id="forward-out" type="source" position={Position.Right} className="debug-handle" style={{ top: "42%" }} />
      <Handle id="return-in" type="target" position={Position.Right} className="debug-handle" style={{ top: "72%" }} />
    </div>
  );
}

function PlaybackCard({ data }: NodeProps<PlaybackNode>) {
  const isBefore = data.mode === "before";

  return (
    <section
      className={`playback-card playback-card--${data.mode}${data.finished ? " is-finished" : ""}`}
      data-testid="playback-card"
      data-flow={data.mode}
      data-current-step={data.step}
      data-total-steps={data.total}
      data-playing={data.playing ? "true" : "false"}
    >
      <span className="playback-drag-indicator"><SvgIcon name="grip" size={14} /></span>
      <div className="playback-summary">
        <span className={`outcome-icon${data.finished ? " is-finished" : ""}`}>
          <SvgIcon name={data.finished ? (isBefore ? "x" : "check") : "play"} size={18} />
        </span>
        <div className="playback-copy">
          <strong>{data.title}</strong>
          <p className="playback-reason"><b>原因</b><span>{data.reason}</span></p>
          <p className="playback-note">{data.note}</p>
        </div>
      </div>

      <div className="playback-control-area nodrag nowheel nopan">
        <div className="playback-controls">
          <div className="playback-buttons">
            <button type="button" data-testid={`playback-toggle-${data.mode}`} onClick={data.onToggle} aria-label={data.playing ? `暫停 ${data.mode}` : `播放 ${data.mode}`}>
              <SvgIcon name={data.playing ? "pause" : "play"} size={14} />
              {data.playing ? "暫停" : "播放"}
            </button>
            <button type="button" data-testid={`playback-replay-${data.mode}`} onClick={data.onReplay}>
              <SvgIcon name="replay" size={14} />
              重播
            </button>
          </div>
        </div>
        <input
          type="range"
          min={0}
          max={data.total - 1}
          value={data.step}
          suppressHydrationWarning
          onChange={(event) => data.onSeek(Number(event.target.value))}
          aria-label={`${data.mode} debug timeline`}
        />
        <div className="playback-progress-label">
          <span>{data.title}</span>
          <code>{data.step + 1} / {data.total}</code>
        </div>
      </div>
    </section>
  );
}

function FreeTextCard({ data }: NodeProps<FreeTextNode>) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div className="canvas-text-item">
      <SvgIcon name="grip" size={13} />
      <input
        ref={inputRef}
        className="nodrag nowheel nopan"
        defaultValue={data.text}
        aria-label="畫布文字"
        onKeyDown={(event) => event.stopPropagation()}
      />
    </div>
  );
}

function NoteCard({ data }: NodeProps<NoteNode>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => textareaRef.current?.focus(), []);

  return (
    <div className="canvas-note-item">
      <Handle type="target" position={Position.Left} className="debug-handle" />
      <span className="canvas-item-grip"><SvgIcon name="grip" size={13} /></span>
      <textarea
        ref={textareaRef}
        className="nodrag nowheel nopan"
        defaultValue={data.text}
        aria-label="畫布便條"
        onKeyDown={(event) => event.stopPropagation()}
      />
      <Handle type="source" position={Position.Right} className="debug-handle" />
    </div>
  );
}

function ShapeCard({ data }: NodeProps<ShapeNode>) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  return (
    <div className="canvas-shape-item">
      <Handle type="target" position={Position.Left} className="debug-handle" />
      <span className="canvas-item-grip"><SvgIcon name="grip" size={13} /></span>
      <input
        ref={inputRef}
        className="nodrag nowheel nopan"
        defaultValue={data.text}
        aria-label="矩形標籤"
        onKeyDown={(event) => event.stopPropagation()}
      />
      <Handle type="source" position={Position.Right} className="debug-handle" />
    </div>
  );
}

function PacketEdgeComponent({ id, sourceX, sourceY, targetX, targetY, data, markerEnd }: EdgeProps<PacketEdge>) {
  const [edgePath, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  const color = data?.color ?? "#687078";
  const active = Boolean(data?.active);

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          stroke: color,
          strokeWidth: active ? 2.4 : 1.45,
          strokeDasharray: data?.muted ? "6 7" : undefined,
          opacity: data?.muted ? 0.35 : active ? 1 : 0.72,
        }}
      />
      {active ? (
        <g className="packet-motion">
          <circle r="10" fill={color} opacity="0.12">
          </circle>
          <circle r="5" fill={color} className="packet-dot">
          </circle>
          <animateMotion dur={`${data?.duration ?? 2.1}s`} repeatCount="indefinite" calcMode="linear" path={edgePath} />
        </g>
      ) : null}
      {data?.label ? (
        <EdgeLabelRenderer>
          <div
            className={`edge-label edge-label--${data.packetKind ?? "request"}`}
            data-testid="edge-label"
            data-edge-id={id}
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY + (data?.labelOffset ?? -24)}px)` }}
          >
            <span />
            {data.label}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

function CanvasToolbar() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();

  return (
    <Panel position="top-left" className="canvas-toolbar">
      <button type="button" data-testid="zoom-in" onClick={() => zoomIn({ duration: 160 })} aria-label="放大" title="放大">
        <SvgIcon name="zoom-in" size={18} />
      </button>
      <button type="button" data-testid="zoom-out" onClick={() => zoomOut({ duration: 160 })} aria-label="縮小" title="縮小">
        <SvgIcon name="zoom-out" size={18} />
      </button>
      <button type="button" data-testid="fit-view" onClick={() => fitView({ padding: 0.12, duration: 280 })} aria-label="將所有內容置中" title="Fit view · 將所有內容置中">
        <SvgIcon name="fit" size={18} />
      </button>
    </Panel>
  );
}

const creationTools: { id: CanvasTool; icon: IconName; label: string }[] = [
  { id: "select", icon: "select", label: "選取與移動物件" },
  { id: "pan", icon: "pan", label: "手掌平移畫布" },
  { id: "connect", icon: "connect", label: "連接節點" },
  { id: "text", icon: "text", label: "新增文字" },
  { id: "note", icon: "note", label: "新增便條" },
  { id: "shape", icon: "shape", label: "新增矩形" },
];

function CreationToolbar({ tool, onToolChange }: { tool: CanvasTool; onToolChange: (tool: CanvasTool) => void }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Panel position="top-left" className={`creation-toolbar${collapsed ? " is-collapsed" : ""}`}>
      {!collapsed ? creationTools.map((item, index) => (
        <span key={item.id} className={index === 3 ? "creation-tool-wrap has-divider" : "creation-tool-wrap"}>
          <button
            type="button"
            className={tool === item.id ? "is-active" : ""}
            onClick={() => onToolChange(item.id)}
            aria-label={item.label}
            aria-pressed={tool === item.id}
            title={item.label}
          >
            <SvgIcon name={item.icon} size={19} />
          </button>
        </span>
      )) : null}
      <button
        type="button"
        className="creation-toolbar__collapse"
        onClick={() => setCollapsed((current) => !current)}
        aria-label={collapsed ? "展開工具列" : "收合工具列"}
        title={collapsed ? "展開工具列" : "收合工具列"}
      >
        <SvgIcon name="collapse" size={17} />
      </button>
    </Panel>
  );
}

const nodeTypes = {
  flowGroup: FlowGroupCard,
  labelNode: TextLabelCard,
  debugNode: DebugNodeCard,
  playbackNode: PlaybackCard,
  freeTextNode: FreeTextCard,
  noteNode: NoteCard,
  shapeNode: ShapeCard,
};
const edgeTypes = { packetEdge: PacketEdgeComponent };

function sequenceFor(flowConfigByMode: FlowConfigByMode, mode: Mode) {
  return flowConfigByMode[mode].steps;
}

function debugData(flowConfigByMode: FlowConfigByMode, mode: Mode, nodeId: string, runtime: FlowRuntime): DebugNodeData {
  const flow = flowConfigByMode[mode];
  const node = flow.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Unknown ${mode} node: ${nodeId}`);

  return {
    mode,
    nodeId: node.id,
    title: node.title,
    subtitle: node.subtitle,
    kind: node.kind,
    logo: node.logo,
    categoryIcon: node.categoryIcon,
    status: flow.steps[runtime.step].nodeStatuses[node.id] ?? "idle",
    changed: node.changed,
    detail: node.detail,
  };
}

function playbackData(flowConfigByMode: FlowConfigByMode, mode: Mode, runtime: FlowRuntime, actions: PlaybackActions): PlaybackData {
  const sequence = sequenceFor(flowConfigByMode, mode);
  const finished = runtime.step === sequence.length - 1;
  const title = sequence[runtime.step].title;

  return {
    mode,
    title,
    note: sequence[runtime.step].note,
    reason: sequence[runtime.step].reason,
    step: runtime.step,
    total: sequence.length,
    playing: runtime.playing,
    finished,
    ...actions,
  };
}

function flowNodes(flowConfigByMode: FlowConfigByMode, mode: Mode, groupPosition: { x: number; y: number }, runtime: FlowRuntime, actions: PlaybackActions): CanvasNode[] {
  const flow = flowConfigByMode[mode];
  const groupId = `${mode}-group`;
  const groupWidth = Math.max(1000, 128 + flow.nodes.length * 310);

  return [
    {
      id: groupId,
      type: "flowGroup",
      position: groupPosition,
      data: { mode },
      style: { width: groupWidth, height: 390 },
      draggable: true,
      selectable: true,
      zIndex: -1,
    },
    {
      id: `${mode}-label`,
      type: "labelNode",
      position: { x: 36, y: 18 },
      parentId: groupId,
      data: { mode, value: flow.label },
      draggable: true,
    },
    ...flow.nodes.map((node, index) => ({
      id: `${mode}-${node.id}`,
      type: "debugNode" as const,
      position: { x: 64 + index * 310, y: 78 },
      parentId: groupId,
      data: debugData(flowConfigByMode, mode, node.id, runtime),
      draggable: true,
    })),
    {
      id: `${mode}-playback`,
      type: "playbackNode",
      position: { x: 135, y: 252 },
      parentId: groupId,
      data: playbackData(flowConfigByMode, mode, runtime, actions),
      draggable: true,
    },
  ];
}

function flowEdges(flowConfigByMode: FlowConfigByMode, mode: Mode, runtime: FlowRuntime): PacketEdge[] {
  const semanticColor: Record<BoardEdgeSemantic, string> = {
    request: "#2563eb",
    query: "#f57c00",
    response: "#16a34a",
    error: "#dc2626",
  };

  return flowConfigByMode[mode].edges.map((edge) => {
    const active = edge.activeSteps.includes(runtime.step);
    const color = active ? semanticColor[edge.semantic] : "#687078";
    const returning = edge.direction === "return";

    return {
      id: `${mode}-${edge.id}`,
      source: `${mode}-${edge.source}`,
      target: `${mode}-${edge.target}`,
      sourceHandle: returning ? "return-out" : "forward-out",
      targetHandle: returning ? "return-in" : "forward-in",
      type: "packetEdge",
      markerEnd: { type: MarkerType.ArrowClosed, color },
      data: {
        active,
        color,
        label: edge.label,
        labelOffset: returning ? 24 : -24,
        duration: 2.15,
        muted: edge.muted,
        packetKind: edge.semantic,
      },
    } satisfies PacketEdge;
  });
}

function useFlowPlayback(runtime: FlowRuntime, setRuntime: Dispatch<SetStateAction<FlowRuntime>>, total: number, timeScale: number) {
  useEffect(() => {
    if (!runtime.playing) return;
    if (runtime.step >= total - 1) {
      setRuntime((current) => ({ ...current, playing: false }));
      return;
    }

    const delay = Math.max(20, (runtime.step === 0 ? 1800 : 2600) * timeScale);
    const timer = window.setTimeout(() => setRuntime((current) => ({ ...current, step: current.step + 1 })), delay);
    return () => window.clearTimeout(timer);
  }, [runtime.playing, runtime.step, setRuntime, timeScale, total]);
}

function nextFrame() {
  return new Promise<void>((resolvePromise) => window.requestAnimationFrame(() => resolvePromise()));
}

async function waitForCanvasAssets() {
  await document.fonts?.ready;
  await Promise.all(Array.from(document.images).map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise<void>((resolvePromise) => {
      image.addEventListener("load", () => resolvePromise(), { once: true });
      image.addEventListener("error", () => resolvePromise(), { once: true });
    });
  }));
}

function BoardCanvas({ loaded }: { loaded: LoadedBoard }) {
  const { config: boardConfig, configHash, finalStep, initialFlow, timeScale } = loaded;
  const flowConfigByMode = useMemo(() => Object.fromEntries(boardConfig.flows.map((flow) => [flow.id, flow])) as FlowConfigByMode, [boardConfig]);
  const initialRuntime = useCallback((mode: Mode): FlowRuntime => ({
    step: finalStep && initialFlow === mode ? flowConfigByMode[mode].steps.length - 1 : 0,
    playing: false,
  }), [finalStep, flowConfigByMode, initialFlow]);
  const [before, setBefore] = useState<FlowRuntime>(() => initialRuntime("before"));
  const [after, setAfter] = useState<FlowRuntime>(() => initialRuntime("after"));
  const [tool, setTool] = useState<CanvasTool>("select");
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<CanvasNode, PacketEdge> | null>(null);
  const [customEdges, setCustomEdges] = useState<PacketEdge[]>([]);
  const [boardReady, setBoardReady] = useState(false);

  useFlowPlayback(before, setBefore, flowConfigByMode.before.steps.length, timeScale);
  useFlowPlayback(after, setAfter, flowConfigByMode.after.steps.length, timeScale);

  const beforeActions = useMemo<PlaybackActions>(() => ({
    onToggle: () => setBefore((current) => ({ ...current, playing: !current.playing })),
    onReplay: () => setBefore((current) => ({ ...current, step: 0, playing: true })),
    onSeek: (step) => setBefore((current) => ({ ...current, step, playing: false })),
  }), []);

  const afterActions = useMemo<PlaybackActions>(() => ({
    onToggle: () => setAfter((current) => ({ ...current, playing: !current.playing })),
    onReplay: () => setAfter((current) => ({ ...current, step: 0, playing: true })),
    onSeek: (step) => setAfter((current) => ({ ...current, step, playing: false })),
  }), []);

  const initialNodes: CanvasNode[] = [
    ...flowNodes(flowConfigByMode, "before", flowConfigByMode.before.position, before, beforeActions),
    ...flowNodes(flowConfigByMode, "after", flowConfigByMode.after.position, after, afterActions),
  ];

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initialNodes);

  useEffect(() => {
    setNodes((current) => current.map((node) => {
      if (node.type === "debugNode") {
        const runtime = node.data.mode === "before" ? before : after;
        return { ...node, data: debugData(flowConfigByMode, node.data.mode, node.data.nodeId, runtime) };
      }
      if (node.type === "playbackNode") {
        const runtime = node.data.mode === "before" ? before : after;
        const actions = node.data.mode === "before" ? beforeActions : afterActions;
        return { ...node, data: playbackData(flowConfigByMode, node.data.mode, runtime, actions) };
      }
      return node;
    }));
  }, [after, afterActions, before, beforeActions, flowConfigByMode, setNodes]);

  const edges = useMemo<PacketEdge[]>(() => [
    ...flowEdges(flowConfigByMode, "before", before),
    ...flowEdges(flowConfigByMode, "after", after),
    ...customEdges,
  ], [after, before, customEdges, flowConfigByMode]);

  const onPaneClick = useCallback((event: ReactMouseEvent) => {
    if (!flowInstance || !["text", "note", "shape"].includes(tool)) return;

    const point = flowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const id = `canvas-${tool}-${Date.now()}`;
    let node: CanvasNode;

    if (tool === "text") {
      node = {
        id,
        type: "freeTextNode",
        position: { x: point.x - 86, y: point.y - 22 },
        data: { text: "輸入文字" },
        draggable: true,
        zIndex: 2,
      };
    } else if (tool === "note") {
      node = {
        id,
        type: "noteNode",
        position: { x: point.x - 90, y: point.y - 58 },
        data: { text: "輸入除錯註記…" },
        draggable: true,
        zIndex: 2,
      };
    } else {
      node = {
        id,
        type: "shapeNode",
        position: { x: point.x - 96, y: point.y - 48 },
        data: { text: "新的節點" },
        draggable: true,
        zIndex: 2,
      };
    }

    setNodes((current) => [...current, node]);
    setTool("select");
  }, [flowInstance, setNodes, tool]);

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return;

    setCustomEdges((current) => [
      ...current,
      {
        id: `canvas-edge-${Date.now()}`,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle,
        targetHandle: connection.targetHandle,
        type: "packetEdge",
        markerEnd: { type: MarkerType.ArrowClosed, color: "#4c5964" },
        data: { color: "#4c5964", packetKind: "request" },
      },
    ]);
  }, []);

  const onInit = useCallback((instance: ReactFlowInstance<CanvasNode, PacketEdge>) => {
    setFlowInstance(instance);
    const markRendered = async () => {
      await nextFrame();
      const problemBoard = instance.getNodes().filter((node) => node.id === "before-group" || node.id === "after-group");
      await instance.fitView({ nodes: problemBoard, padding: 0.08, maxZoom: 1, duration: 0 });
      await waitForCanvasAssets();
      await nextFrame();
      await nextFrame();
      setBoardReady(true);
    };
    void markRendered();
  }, []);

  const serviceNodeCount = boardConfig.flows.reduce((count, flow) => count + flow.nodes.length, 0);
  const edgeCount = boardConfig.flows.reduce((count, flow) => count + flow.edges.length, 0);

  return (
    <main
      className="canvas-app"
      data-board-ready={boardReady ? "true" : "false"}
      data-config-sha256={configHash}
      data-render-protocol={renderProtocol}
      data-service-node-count={serviceNodeCount}
      data-edge-count={edgeCount}
      data-label-count={edgeCount}
    >
      <ReactFlow
        className={`canvas-tool--${tool}`}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onInit={onInit}
        onPaneClick={onPaneClick}
        onConnect={onConnect}
        nodesConnectable={tool === "connect"}
        nodesDraggable={tool === "select"}
        panOnScroll
        panOnDrag={tool === "pan"}
        selectionOnDrag={tool === "select"}
        zoomOnDoubleClick={false}
        minZoom={0.3}
        maxZoom={1.6}
        proOptions={{ hideAttribution: true }}
        aria-label={`${boardConfig.title} behavior debug canvas`}
      >
        <Background gap={22} size={1.15} color="#d6d9dc" />
        <CanvasToolbar />
        <CreationToolbar tool={tool} onToolChange={setTool} />
      </ReactFlow>
    </main>
  );
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export default function Home() {
  const [loaded, setLoaded] = useState<LoadedBoard | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const load = async () => {
      const params = new URLSearchParams(window.location.search);
      const requestedHash = params.get("config");
      const initialFlow: Mode = params.get("flow") === "before" ? "before" : "after";
      const finalStep = params.get("step") === "final";
      const requestedTimeScale = Number(params.get("timeScale") ?? "1");
      const timeScale = Number.isFinite(requestedTimeScale) && requestedTimeScale > 0 ? Math.max(0.01, requestedTimeScale) : 1;

      if (!requestedHash) {
        setLoaded({ config: embeddedBoardConfig, configHash: "embedded", finalStep, initialFlow, timeScale });
        return;
      }
      if (!/^[a-f0-9]{64}$/.test(requestedHash)) throw new Error("Invalid runtime config hash");

      const response = await fetch(`/runtime/${requestedHash}.json`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Runtime config returned HTTP ${response.status}`);
      const source = await response.text();
      const actualHash = await sha256(source);
      if (actualHash !== requestedHash) throw new Error(`Runtime config hash mismatch: expected ${requestedHash}, received ${actualHash}`);
      setLoaded({ config: JSON.parse(source) as BoardConfig, configHash: requestedHash, finalStep, initialFlow, timeScale });
    };

    void load().catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, []);

  if (loadError) {
    return <main className="canvas-app" data-board-ready="false" data-board-error={loadError} role="alert">{loadError}</main>;
  }
  if (!loaded) {
    return <main className="canvas-app" data-board-ready="false" aria-busy="true" />;
  }
  return <BoardCanvas key={loaded.configHash} loaded={loaded} />;
}
