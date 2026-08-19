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
  getBezierPath,
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
  BoardNodeConfig,
  BoardNodeKind,
  BoardScreenFrame,
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
  screenshot?: string;
  frame?: BoardScreenFrame;
  route?: string;
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
type FreeTextData = { text: string; autoFocus?: boolean };
type NoteData = { text: string; autoFocus?: boolean };
type ShapeData = { text: string; autoFocus?: boolean };

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
  labelLane?: "above" | "below";
  labelOffset?: number;
  duration?: number;
  muted?: boolean;
  packetKind?: BoardEdgeSemantic;
  curved?: boolean;
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
  assetHash: string;
  session: number;
  finalStep: boolean;
  initialFlow: Mode;
  saveEndpoint?: string;
  saveToken?: string;
  timeScale: number;
};

type BoardRevision = {
  id: string;
  source: "git" | "local";
  createdAt: string;
  title: string;
  sha256?: string;
  shortCommit?: string;
  active?: boolean;
  unavailable?: boolean;
};

type SemanticChange = {
  type: "added" | "removed" | "changed" | "moved";
  entity: string;
  id: string;
  label: string;
  detail: string;
  flow?: Mode;
};

type SemanticDiff = {
  summary: Record<SemanticChange["type"], number>;
  changes: SemanticChange[];
  empty: boolean;
};

type FlowConfigByMode = Record<Mode, BoardFlowConfig>;
type SingleSourceFanout = { source: string; targets: [string, string] };

const embeddedBoardConfig = boardConfigJson as BoardConfig;
const renderProtocol = "5";
const serviceNodeWidth = 226;
const browserScreenNodeWidth = 380;
const mobileScreenNodeWidth = 230;
const minimumNodeGap = 84;
const edgeLabelChromeWidth = 26;
const edgeLabelSafetyGap = 24;

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
  screen: "web-app",
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

function TextLabelCard({ id, data }: NodeProps<LabelNode>) {
  const { updateNodeData } = useReactFlow<LabelNode, PacketEdge>();
  return (
    <label className={`text-label-card text-label-card--${data.mode}`}>
      <SvgIcon name="grip" size={14} />
      <input
        className="nodrag nowheel nopan"
        value={data.value}
        aria-label={`${data.mode} flow label`}
        onChange={(event) => updateNodeData(id, { value: event.target.value })}
        onKeyDown={(event) => event.stopPropagation()}
      />
    </label>
  );
}

function NodeStatusIndicator({ status }: { status: NodeStatus }) {
  return (
    <span className={`node-status node-status--${status}`} aria-live="polite">
      {status === "running"
        ? <span className="node-status__spinner" aria-hidden="true" />
        : <span className="node-status__dot" />}
      {statusLabel[status]}
    </span>
  );
}

function DebugNodeCard({ id, data }: NodeProps<DebugNode>) {
  const { updateNodeData } = useReactFlow<DebugNode, PacketEdge>();
  const updateCopy = (field: "title" | "subtitle", value: string) => updateNodeData(id, { [field]: value });
  const isScreen = data.kind === "screen";
  const screenFrame = data.frame ?? "browser";
  const screenFrameLabel = screenFrame === "mobile" ? "Mobile" : screenFrame === "app" ? "App" : "Web";

  return (
    <div
      className={`debug-node debug-node--${data.kind} debug-node--${data.status}${isScreen ? ` debug-node--screen-${screenFrame}` : ""}`}
      data-testid="service-node"
      data-node-kind={data.kind}
      data-screen-frame={isScreen ? screenFrame : undefined}
      data-flow={data.mode}
      data-node-id={data.nodeId}
      data-status={data.status}
    >
      <Handle id="forward-in" type="target" position={Position.Left} className="debug-handle" style={{ top: "42%" }} />
      <Handle id="return-out" type="source" position={Position.Left} className="debug-handle" style={{ top: "72%" }} />
      {isScreen ? (
        <>
          <div className="screen-card__header">
            <div className="screen-card__meta">
              <span className="screen-card__frame-label">{screenFrameLabel}</span>
              {data.changed ? <span className="screen-card__changed">已修改</span> : null}
              <NodeStatusIndicator status={data.status} />
            </div>
            <input
              className="screen-card__copy screen-card__copy--title nodrag nowheel nopan"
              data-testid="service-title-input"
              value={data.title}
              aria-label={`${data.mode} ${data.nodeId} card title`}
              onChange={(event) => updateCopy("title", event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <input
              className="screen-card__copy screen-card__copy--description nodrag nowheel nopan"
              data-testid="service-description-input"
              value={data.subtitle}
              aria-label={`${data.mode} ${data.nodeId} card description`}
              onChange={(event) => updateCopy("subtitle", event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
          <figure className={`screen-preview screen-preview--${screenFrame}`} data-testid="screen-preview">
          {screenFrame !== "mobile" ? (
            <figcaption className="screen-preview__chrome">
              {screenFrame === "browser" ? <span className="screen-preview__dots" aria-hidden="true"><i /><i /><i /></span> : null}
              <span>{data.route || (screenFrame === "app" ? "Desktop App" : "Web")}</span>
            </figcaption>
          ) : <span className="screen-preview__island" aria-hidden="true" />}
          {/* Board screenshots are durable local assets copied into the hash-addressed runtime bundle. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="screen-preview__image nodrag" src={data.screenshot} alt={`${data.title} 畫面截圖`} draggable={false} />
          </figure>
        </>
      ) : (
        <>
          <div className="debug-node__topline">
            <div className="debug-node__icon"><ServiceIcon data={data} /></div>
            <NodeStatusIndicator status={data.status} />
          </div>
          <div className="debug-node__body">
            <input
              className="debug-node__copy debug-node__copy--title nodrag nowheel nopan"
              data-testid="service-title-input"
              value={data.title}
              aria-label={`${data.mode} ${data.nodeId} card title`}
              onChange={(event) => updateCopy("title", event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <input
              className="debug-node__copy debug-node__copy--description nodrag nowheel nopan"
              data-testid="service-description-input"
              value={data.subtitle}
              aria-label={`${data.mode} ${data.nodeId} card description`}
              onChange={(event) => updateCopy("subtitle", event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </div>
          <div className="debug-node__detail">
            {data.changed ? <span className="changed-badge">修改位置</span> : null}
            <span>{data.detail}</span>
          </div>
        </>
      )}
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

function FreeTextCard({ id, data }: NodeProps<FreeTextNode>) {
  const { updateNodeData } = useReactFlow<FreeTextNode, PacketEdge>();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (data.autoFocus) inputRef.current?.focus(); }, [data.autoFocus]);

  return (
    <div className="canvas-text-item">
      <SvgIcon name="grip" size={13} />
      <input
        ref={inputRef}
        className="nodrag nowheel nopan"
        value={data.text}
        aria-label="畫布文字"
        onChange={(event) => updateNodeData(id, { text: event.target.value, autoFocus: false })}
        onKeyDown={(event) => event.stopPropagation()}
      />
    </div>
  );
}

function NoteCard({ id, data }: NodeProps<NoteNode>) {
  const { updateNodeData } = useReactFlow<NoteNode, PacketEdge>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (data.autoFocus) textareaRef.current?.focus(); }, [data.autoFocus]);

  return (
    <div className="canvas-note-item">
      <Handle type="target" position={Position.Left} className="debug-handle" />
      <span className="canvas-item-grip"><SvgIcon name="grip" size={13} /></span>
      <textarea
        ref={textareaRef}
        className="nodrag nowheel nopan"
        value={data.text}
        aria-label="畫布便條"
        onChange={(event) => updateNodeData(id, { text: event.target.value, autoFocus: false })}
        onKeyDown={(event) => event.stopPropagation()}
      />
      <Handle type="source" position={Position.Right} className="debug-handle" />
    </div>
  );
}

function ShapeCard({ id, data }: NodeProps<ShapeNode>) {
  const { updateNodeData } = useReactFlow<ShapeNode, PacketEdge>();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (data.autoFocus) inputRef.current?.focus(); }, [data.autoFocus]);

  return (
    <div className="canvas-shape-item">
      <Handle type="target" position={Position.Left} className="debug-handle" />
      <span className="canvas-item-grip"><SvgIcon name="grip" size={13} /></span>
      <input
        ref={inputRef}
        className="nodrag nowheel nopan"
        value={data.text}
        aria-label="矩形標籤"
        onChange={(event) => updateNodeData(id, { text: event.target.value, autoFocus: false })}
        onKeyDown={(event) => event.stopPropagation()}
      />
      <Handle type="source" position={Position.Right} className="debug-handle" />
    </div>
  );
}

function PacketEdgeComponent({ id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data, markerEnd }: EdgeProps<PacketEdge>) {
  const [edgePath, labelX, labelY] = data?.curved
    ? getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.18 })
    : getStraightPath({ sourceX, sourceY, targetX, targetY });
  const color = data?.color ?? "#687078";
  const active = Boolean(data?.active);

  return (
    <>
      <BaseEdge
        id={id}
        className={`packet-edge-path${data?.curved ? " packet-edge-path--curved" : ""}`}
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
            data-label-lane={data.labelLane}
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

function runtimeAssetUrl(asset: string | undefined, assetBase?: string) {
  return asset?.startsWith("assets/") && assetBase ? `${assetBase}/${asset.slice("assets/".length)}` : asset;
}

function debugData(flowConfigByMode: FlowConfigByMode, mode: Mode, nodeId: string, runtime: FlowRuntime, assetBase?: string): DebugNodeData {
  const flow = flowConfigByMode[mode];
  const node = flow.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new Error(`Unknown ${mode} node: ${nodeId}`);

  return {
    mode,
    nodeId: node.id,
    title: node.title,
    subtitle: node.subtitle,
    kind: node.kind,
    logo: runtimeAssetUrl(node.logo, assetBase),
    categoryIcon: node.categoryIcon,
    screenshot: runtimeAssetUrl(node.screenshot, assetBase),
    frame: node.frame,
    route: node.route,
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

function estimatedEdgeLabelWidth(label: string) {
  const textWidth = Array.from(label).reduce((width, character) => (
    width + ((character.codePointAt(0) ?? 0) <= 0xff ? 4.4 : 7)
  ), 0);
  return textWidth + edgeLabelChromeWidth;
}

function nodeWidth(node: BoardNodeConfig) {
  if (node.kind !== "screen") return serviceNodeWidth;
  return node.frame === "mobile" ? mobileScreenNodeWidth : browserScreenNodeWidth;
}

function nodeHeight(node: BoardNodeConfig) {
  if (node.kind !== "screen") return 150;
  return node.frame === "mobile" ? 535 : 390;
}

function nodePositionsForFlow(flow: BoardFlowConfig) {
  const positions = [64];

  for (let index = 0; index < flow.nodes.length - 1; index += 1) {
    const currentId = flow.nodes[index].id;
    const nextId = flow.nodes[index + 1].id;
    const labelsBetweenNodes = flow.edges
      .filter((edge) => (
        (edge.source === currentId && edge.target === nextId)
        || (edge.source === nextId && edge.target === currentId)
      ))
      .map((edge) => estimatedEdgeLabelWidth(edge.label));
    const requiredLabelGap = labelsBetweenNodes.length > 0
      ? Math.ceil(Math.max(...labelsBetweenNodes) + edgeLabelSafetyGap)
      : minimumNodeGap;
    const gap = Math.max(minimumNodeGap, requiredLabelGap);
    positions.push(positions[index] + nodeWidth(flow.nodes[index]) + gap);
  }

  return positions;
}

function singleSourceFanout(flow: BoardFlowConfig): SingleSourceFanout | null {
  if (flow.nodes.some((node) => node.kind === "screen")) return null;
  if (flow.nodes.length !== 3) return null;

  const forwardEdges = flow.edges.filter((edge) => edge.direction === "forward");
  const sources = [...new Set(forwardEdges.map((edge) => edge.source))];
  if (sources.length !== 1) return null;

  const source = sources[0];
  const targetSet = new Set(forwardEdges.filter((edge) => edge.source === source).map((edge) => edge.target));
  const targets = flow.nodes.map((node) => node.id).filter((nodeId) => targetSet.has(nodeId));
  if (targets.length !== 2 || new Set([source, ...targets]).size !== 3) return null;

  return { source, targets: [targets[0], targets[1]] };
}

function flowGeometry(flow: BoardFlowConfig) {
  const nodePositions = nodePositionsForFlow(flow);
  const fanout = singleSourceFanout(flow);
  const finalNode = flow.nodes.at(-1)!;
  const maxNodeHeight = Math.max(...flow.nodes.map(nodeHeight));
  const groupWidth = fanout ? 1040 : Math.max(1000, nodePositions.at(-1)! + nodeWidth(finalNode) + 64);
  const playbackY = fanout ? 390 : 78 + maxNodeHeight + 48;
  const groupHeight = fanout ? 535 : playbackY + 138;
  return { fanout, groupHeight, groupWidth, nodePositions, playbackY };
}

function stackedFlowPositions(flowConfigByMode: FlowConfigByMode) {
  const before = flowConfigByMode.before.position;
  const minimumAfterY = before.y + flowGeometry(flowConfigByMode.before).groupHeight + 56;
  return {
    before,
    after: {
      ...flowConfigByMode.after.position,
      y: Math.max(flowConfigByMode.after.position.y, minimumAfterY),
    },
  };
}

function flowNodes(flowConfigByMode: FlowConfigByMode, mode: Mode, groupPosition: { x: number; y: number }, runtime: FlowRuntime, actions: PlaybackActions, assetBase?: string): CanvasNode[] {
  const flow = flowConfigByMode[mode];
  const groupId = `${mode}-group`;
  const { fanout, groupHeight, groupWidth, nodePositions, playbackY } = flowGeometry(flow);

  const servicePosition = (nodeId: string, index: number) => {
    const persisted = flow.nodes.find((node) => node.id === nodeId)?.position;
    if (persisted) return persisted;
    if (!fanout) return { x: nodePositions[index], y: 78 };
    if (nodeId === fanout.source) return { x: 90, y: 143 };
    const targetIndex = fanout.targets.indexOf(nodeId);
    return { x: 700, y: targetIndex === 0 ? 68 : 218 };
  };

  return [
    {
      id: groupId,
      type: "flowGroup",
      position: groupPosition,
      data: { mode },
      style: { width: groupWidth, height: groupHeight },
      draggable: true,
      selectable: true,
      zIndex: -1,
    },
    {
      id: `${mode}-label`,
      type: "labelNode",
      position: flow.labelPosition ?? { x: 36, y: 18 },
      parentId: groupId,
      data: { mode, value: flow.label },
      draggable: true,
    },
    ...flow.nodes.map((node, index) => ({
      id: `${mode}-${node.id}`,
      type: "debugNode" as const,
      position: servicePosition(node.id, index),
      parentId: groupId,
      data: debugData(flowConfigByMode, mode, node.id, runtime, assetBase),
      draggable: true,
    })),
    {
      id: `${mode}-playback`,
      type: "playbackNode",
      position: flow.playbackPosition ?? { x: (groupWidth - 720) / 2, y: playbackY },
      parentId: groupId,
      data: playbackData(flowConfigByMode, mode, runtime, actions),
      draggable: true,
    },
  ];
}

function persistedCanvasNodes(boardConfig: BoardConfig): CanvasNode[] {
  return (boardConfig.canvas?.items ?? []).map((item) => ({
    id: item.id,
    type: item.type === "text" ? "freeTextNode" : item.type === "note" ? "noteNode" : "shapeNode",
    position: item.position,
    data: { text: item.text, autoFocus: false },
    draggable: true,
    zIndex: 2,
  } as CanvasNode));
}

function persistedCanvasEdges(boardConfig: BoardConfig): PacketEdge[] {
  return (boardConfig.canvas?.edges ?? []).map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle,
    targetHandle: edge.targetHandle,
    type: "packetEdge",
    markerEnd: { type: MarkerType.ArrowClosed, color: "#4c5964" },
    data: { color: "#4c5964", packetKind: "request" },
  }));
}

function stablePosition(position: { x: number; y: number }) {
  return { x: Math.round(position.x * 100) / 100, y: Math.round(position.y * 100) / 100 };
}

function persistedBoardDocument(boardConfig: BoardConfig, nodes: CanvasNode[], customEdges: PacketEdge[]): BoardConfig {
  const document = structuredClone(boardConfig);
  document.version = boardConfig.version === 3 || boardConfig.flows.some((flow) => flow.nodes.some((node) => node.kind === "screen")) ? 3 : 2;
  document.flows = document.flows.map((flow) => {
    const groupNode = nodes.find((node) => node.id === `${flow.id}-group`);
    const labelNode = nodes.find((node): node is LabelNode => node.id === `${flow.id}-label` && node.type === "labelNode");
    const playbackNode = nodes.find((node) => node.id === `${flow.id}-playback`);
    return {
      ...flow,
      label: labelNode?.data.value ?? flow.label,
      position: groupNode ? stablePosition(groupNode.position) : flow.position,
      labelPosition: labelNode ? stablePosition(labelNode.position) : flow.labelPosition,
      playbackPosition: playbackNode ? stablePosition(playbackNode.position) : flow.playbackPosition,
      nodes: flow.nodes.map((configNode) => {
        const renderedNode = nodes.find((node): node is DebugNode => node.id === `${flow.id}-${configNode.id}` && node.type === "debugNode");
        if (!renderedNode) return configNode;
        return {
          ...configNode,
          title: renderedNode.data.title,
          subtitle: renderedNode.data.subtitle,
          position: stablePosition(renderedNode.position),
        };
      }),
    };
  }) as BoardConfig["flows"];

  document.canvas = {
    items: nodes.flatMap((node) => {
      if (node.type === "freeTextNode") return [{ id: node.id, type: "text" as const, position: stablePosition(node.position), text: node.data.text }];
      if (node.type === "noteNode") return [{ id: node.id, type: "note" as const, position: stablePosition(node.position), text: node.data.text }];
      if (node.type === "shapeNode") return [{ id: node.id, type: "shape" as const, position: stablePosition(node.position), text: node.data.text }];
      return [];
    }),
    edges: customEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
    })),
  };
  return document;
}

function flowEdges(flowConfigByMode: FlowConfigByMode, mode: Mode, runtime: FlowRuntime): PacketEdge[] {
  const semanticColor: Record<BoardEdgeSemantic, string> = {
    request: "#2563eb",
    query: "#f57c00",
    response: "#16a34a",
    error: "#dc2626",
  };

  const flow = flowConfigByMode[mode];
  const fanout = singleSourceFanout(flow);

  return flow.edges.map((edge) => {
    const active = edge.activeSteps.includes(runtime.step);
    const color = active ? semanticColor[edge.semantic] : "#687078";
    const returning = edge.direction === "return";
    const branchNodeId = fanout
      ? edge.source === fanout.source
        ? edge.target
        : edge.target === fanout.source
          ? edge.source
          : undefined
      : undefined;
    const branchIndex = fanout && branchNodeId ? fanout.targets.indexOf(branchNodeId) : -1;
    const labelLane = branchIndex === 0 ? "above" : branchIndex === 1 ? "below" : undefined;

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
        labelLane,
        labelOffset: labelLane === "above" ? -24 : labelLane === "below" ? 24 : returning ? 24 : -24,
        duration: 2.15,
        muted: edge.muted,
        packetKind: edge.semantic,
        curved: Boolean(fanout && (edge.source === fanout.source || edge.target === fanout.source)),
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

type SaveMeta = {
  path?: string;
  message?: string;
  git?: { tracked: boolean; branch?: string; status?: string };
};

type SaveBridgeState = "missing" | "checking" | "online" | "offline";

function BoardSavePanel({ enabled, state, meta, storageMode, onSave, onToggleVersions, versionsOpen }: {
  enabled: boolean;
  state: "saved" | "dirty" | "saving" | "error";
  meta: SaveMeta;
  storageMode: "git" | "local";
  onSave: () => void;
  onToggleVersions: () => void;
  versionsOpen: boolean;
}) {
  const displayState = enabled ? state : "error";
  const label = !enabled
    ? "本地儲存未連接"
    : state === "saving"
      ? "儲存中…"
      : state === "dirty"
        ? "尚未儲存"
        : state === "error"
          ? "儲存失敗"
          : "已存到本機";
  const gitLabel = storageMode === "git"
    ? meta.git?.tracked
      ? `${meta.git.branch ?? "Git"} · ${meta.git.status === "clean" ? "Git clean" : "Git 未提交"}`
      : "Git 模式尚未連接 repository"
    : "只存本機 · 不建立 Git commit";

  return (
    <Panel position="top-right" className="board-save-panel">
      <div data-testid="board-save-status" data-save-state={displayState}>
        <span className={`board-save-panel__dot board-save-panel__dot--${displayState}`} />
        <div>
          <strong>{label}</strong>
          <small title={meta.path}>{!enabled ? meta.message ?? "正在確認 Save Bridge" : state === "error" ? meta.message : gitLabel}</small>
        </div>
        <div className="board-save-panel__actions">
          <button type="button" data-testid="board-version-toggle" aria-expanded={versionsOpen} disabled={!enabled} onClick={onToggleVersions}>版本</button>
          <button type="button" data-testid="board-save-button" disabled={!enabled || state === "saving"} onClick={onSave}>儲存</button>
        </div>
      </div>
    </Panel>
  );
}

function BoardVersionPanel({
  open,
  storageMode,
  revisions,
  busy,
  error,
  title,
  selectedRevision,
  diff,
  restoreCandidate,
  onTitleChange,
  onCreate,
  onCompare,
  onRestoreRequest,
  onRestoreConfirm,
  onRestoreCancel,
  onClose,
}: {
  open: boolean;
  storageMode: "git" | "local";
  revisions: BoardRevision[];
  busy: boolean;
  error?: string;
  title: string;
  selectedRevision?: string;
  diff?: SemanticDiff;
  restoreCandidate?: string;
  onTitleChange: (title: string) => void;
  onCreate: () => void;
  onCompare: (revision: BoardRevision) => void;
  onRestoreRequest: (revision: BoardRevision) => void;
  onRestoreConfirm: () => void;
  onRestoreCancel: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const typeLabel: Record<SemanticChange["type"], string> = { added: "新增", removed: "移除", changed: "修改", moved: "移動" };

  return (
    <Panel position="top-right" className="board-version-panel nodrag nowheel nopan" data-testid="board-version-panel">
      <header>
        <div>
          <strong>版本紀錄</strong>
          <small>{storageMode === "git" ? "Git 本機 commit" : "本機 snapshots"}</small>
        </div>
        <button type="button" className="board-version-panel__close" aria-label="關閉版本紀錄" onClick={onClose}>×</button>
      </header>

      <div className="board-version-create">
        <input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          placeholder="簡短說明這一版…"
          aria-label="版本說明"
          maxLength={72}
        />
        <button type="button" data-testid="board-version-create" disabled={busy || !title.trim()} onClick={onCreate}>建立版本</button>
      </div>

      {error ? <p className="board-version-error" role="alert">{error}</p> : null}

      <div className="board-version-list" aria-busy={busy}>
        {revisions.length === 0 ? <p className="board-version-empty">還沒有版本。儲存目前狀態後建立第一版。</p> : null}
        {revisions.map((revision) => (
          <article key={revision.id} className={selectedRevision === revision.id ? "is-selected" : ""} data-revision-id={revision.id}>
            <div className="board-version-list__copy">
              <strong>{revision.title}</strong>
              <small>
                {revision.source === "git" ? revision.shortCommit : "本機"}
                {" · "}
                {new Date(revision.createdAt).toLocaleString("zh-TW", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                {revision.active ? " · 目前版本" : ""}
              </small>
            </div>
            <div className="board-version-list__actions">
              <button type="button" disabled={busy || revision.unavailable} onClick={() => onCompare(revision)}>比較</button>
              <button type="button" disabled={busy || revision.unavailable || revision.active} onClick={() => onRestoreRequest(revision)}>還原</button>
            </div>
            {restoreCandidate === revision.id ? (
              <div className="board-version-confirm">
                <span>會先保存目前狀態，再還原這一版。</span>
                <button type="button" data-testid="board-version-restore-confirm" onClick={onRestoreConfirm}>確定</button>
                <button type="button" onClick={onRestoreCancel}>取消</button>
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {diff ? (
        <section className="board-version-diff" data-testid="board-version-diff">
          <header>
            <strong>相較目前 Board</strong>
            <div>
              {(Object.entries(diff.summary) as [SemanticChange["type"], number][]).map(([type, count]) => count > 0 ? (
                <span key={type} className={`semantic-count semantic-count--${type}`}>{typeLabel[type]} {count}</span>
              ) : null)}
            </div>
          </header>
          {diff.empty ? <p>這一版與目前 Board 沒有語意差異。</p> : (
            <ul>
              {diff.changes.slice(0, 30).map((change, index) => (
                <li key={`${change.type}-${change.entity}-${change.id}-${index}`} className={`semantic-change semantic-change--${change.type}`}>
                  <span>{typeLabel[change.type]}</span>
                  <div><strong>{change.label}</strong><small>{change.detail}</small></div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </Panel>
  );
}

function BoardCanvas({ loaded, onRestored }: { loaded: LoadedBoard; onRestored: (config: BoardConfig, hash: string, git?: SaveMeta["git"]) => void }) {
  const { config: boardConfig, configHash, assetHash, finalStep, initialFlow, saveEndpoint, saveToken, timeScale } = loaded;
  const flowConfigByMode = useMemo(() => Object.fromEntries(boardConfig.flows.map((flow) => [flow.id, flow])) as FlowConfigByMode, [boardConfig]);
  const assetBase = assetHash === "embedded" ? undefined : `/runtime/assets/${assetHash}`;
  const initialRuntime = useCallback((mode: Mode): FlowRuntime => ({
    step: finalStep && initialFlow === mode ? flowConfigByMode[mode].steps.length - 1 : 0,
    playing: false,
  }), [finalStep, flowConfigByMode, initialFlow]);
  const [before, setBefore] = useState<FlowRuntime>(() => initialRuntime("before"));
  const [after, setAfter] = useState<FlowRuntime>(() => initialRuntime("after"));
  const [tool, setTool] = useState<CanvasTool>("select");
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance<CanvasNode, PacketEdge> | null>(null);
  const [customEdges, setCustomEdges] = useState<PacketEdge[]>(() => persistedCanvasEdges(boardConfig));
  const [boardReady, setBoardReady] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const [saveBridgeState, setSaveBridgeState] = useState<SaveBridgeState>(saveEndpoint && saveToken ? "checking" : "missing");
  const [saveMeta, setSaveMeta] = useState<SaveMeta>({});
  const [savedHash, setSavedHash] = useState(configHash);
  const [versionPanelOpen, setVersionPanelOpen] = useState(false);
  const [storageMode, setStorageMode] = useState<"git" | "local">("local");
  const [revisions, setRevisions] = useState<BoardRevision[]>([]);
  const [versionBusy, setVersionBusy] = useState(false);
  const [versionError, setVersionError] = useState("");
  const [versionTitle, setVersionTitle] = useState("");
  const [selectedRevision, setSelectedRevision] = useState<string>();
  const [revisionDiff, setRevisionDiff] = useState<SemanticDiff>();
  const [restoreCandidate, setRestoreCandidate] = useState<string>();
  const savePromiseRef = useRef<Promise<string | undefined> | null>(null);

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

  const initialFlowPositions = stackedFlowPositions(flowConfigByMode);
  const initialNodes: CanvasNode[] = [
    ...flowNodes(flowConfigByMode, "before", initialFlowPositions.before, before, beforeActions, assetBase),
    ...flowNodes(flowConfigByMode, "after", initialFlowPositions.after, after, afterActions, assetBase),
    ...persistedCanvasNodes(boardConfig),
  ];

  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(initialNodes);
  const persistedDocument = useMemo(() => persistedBoardDocument(boardConfig, nodes, customEdges), [boardConfig, customEdges, nodes]);
  const persistedSource = useMemo(() => `${JSON.stringify(persistedDocument, null, 2)}\n`, [persistedDocument]);
  const savedSourceRef = useRef(persistedSource);

  useEffect(() => {
    if (!saveEndpoint || !saveToken) return;
    let stopped = false;
    const checkBridge = async () => {
      try {
        const response = await fetch(`${saveEndpoint}/health`, {
          headers: { "x-board-token": saveToken },
          cache: "no-store",
        });
        const result = await response.json() as { path?: string; git?: SaveMeta["git"]; storageMode?: "git" | "local"; error?: string };
        if (!response.ok) throw new Error(result.error ?? `health returned HTTP ${response.status}`);
        if (stopped) return;
        setSaveBridgeState("online");
        setSaveMeta({ path: result.path, git: result.git });
        setStorageMode(result.storageMode === "git" ? "git" : "local");
      } catch {
        if (stopped) return;
        setSaveBridgeState("offline");
        setSaveMeta({ message: "本地寫檔服務已離線，請重新執行 difftale launch" });
        setSaveState("error");
      }
    };
    void checkBridge();
    const heartbeat = window.setInterval(() => { void checkBridge(); }, 10_000);
    return () => {
      stopped = true;
      window.clearInterval(heartbeat);
    };
  }, [saveEndpoint, saveToken]);

  useEffect(() => {
    if (persistedSource !== savedSourceRef.current && saveState === "saved") setSaveState("dirty");
  }, [persistedSource, saveState]);

  const saveBoard = useCallback(() => {
    if (!saveEndpoint || !saveToken || saveBridgeState !== "online") return Promise.resolve(undefined);
    if (savePromiseRef.current) return savePromiseRef.current;
    setSaveState("saving");
    const operation = (async () => {
      try {
        const response = await fetch(`${saveEndpoint}/save`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-board-token": saveToken },
          body: JSON.stringify({ baseHash: savedHash, config: persistedDocument }),
        });
        const result = await response.json() as { error?: string; path?: string; sha256?: string; git?: SaveMeta["git"] };
        if (!response.ok || !result.sha256) throw new Error(result.error ?? `save returned HTTP ${response.status}`);
        savedSourceRef.current = persistedSource;
        setSavedHash(result.sha256);
        setSaveMeta({ path: result.path, git: result.git });
        setSaveState("saved");
        return result.sha256;
      } catch (error) {
        setSaveMeta({ message: error instanceof Error ? error.message : String(error) });
        setSaveState("error");
        return undefined;
      }
    })();
    savePromiseRef.current = operation;
    void operation.finally(() => {
      if (savePromiseRef.current === operation) savePromiseRef.current = null;
    });
    return operation;
  }, [persistedDocument, persistedSource, saveBridgeState, saveEndpoint, saveToken, savedHash]);

  const ensureBoardSaved = useCallback(async () => {
    let stableHash = savedHash;
    if (savePromiseRef.current) {
      const pendingHash = await savePromiseRef.current;
      if (!pendingHash) return undefined;
      stableHash = pendingHash;
    }
    if (persistedSource !== savedSourceRef.current) {
      const nextHash = await saveBoard();
      if (!nextHash) return undefined;
      stableHash = nextHash;
    }
    return stableHash;
  }, [persistedSource, saveBoard, savedHash]);

  const loadVersions = useCallback(async () => {
    if (!saveEndpoint || !saveToken) return;
    setVersionBusy(true);
    setVersionError("");
    try {
      const response = await fetch(`${saveEndpoint}/versions`, { headers: { "x-board-token": saveToken } });
      const result = await response.json() as { error?: string; storageMode?: "git" | "local"; revisions?: BoardRevision[] };
      if (!response.ok) throw new Error(result.error ?? `versions returned HTTP ${response.status}`);
      setStorageMode(result.storageMode === "git" ? "git" : "local");
      setRevisions(result.revisions ?? []);
    } catch (error) {
      setVersionError(error instanceof Error ? error.message : String(error));
    } finally {
      setVersionBusy(false);
    }
  }, [saveEndpoint, saveToken]);

  const toggleVersions = useCallback(() => {
    setVersionPanelOpen((current) => {
      if (!current) void loadVersions();
      return !current;
    });
  }, [loadVersions]);

  const createVersion = useCallback(async () => {
    if (!saveEndpoint || !saveToken || !versionTitle.trim()) return;
    setVersionBusy(true);
    setVersionError("");
    try {
      const saved = await ensureBoardSaved();
      if (!saved) throw new Error("請先完成本地儲存，再建立版本");
      const response = await fetch(`${saveEndpoint}/version`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-board-token": saveToken },
        body: JSON.stringify({ title: versionTitle.trim() }),
      });
      const result = await response.json() as {
        error?: string;
        revision?: BoardRevision;
        versions?: { revisions?: BoardRevision[] };
        git?: SaveMeta["git"];
      };
      if (!response.ok || !result.revision) throw new Error(result.error ?? `version returned HTTP ${response.status}`);
      setRevisions(result.versions?.revisions ?? []);
      setVersionTitle("");
      setSelectedRevision(result.revision.id);
      setRevisionDiff({ summary: { added: 0, removed: 0, changed: 0, moved: 0 }, changes: [], empty: true });
      setSaveMeta((current) => ({ ...current, git: result.git ?? current.git }));
    } catch (error) {
      setVersionError(error instanceof Error ? error.message : String(error));
    } finally {
      setVersionBusy(false);
    }
  }, [ensureBoardSaved, saveEndpoint, saveToken, versionTitle]);

  const compareVersion = useCallback(async (revision: BoardRevision) => {
    if (!saveEndpoint || !saveToken) return;
    setVersionBusy(true);
    setVersionError("");
    setSelectedRevision(revision.id);
    setRestoreCandidate(undefined);
    try {
      const response = await fetch(`${saveEndpoint}/diff`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-board-token": saveToken },
        body: JSON.stringify({ revisionId: revision.id }),
      });
      const result = await response.json() as { error?: string; diff?: SemanticDiff };
      if (!response.ok || !result.diff) throw new Error(result.error ?? `diff returned HTTP ${response.status}`);
      setRevisionDiff(result.diff);
    } catch (error) {
      setVersionError(error instanceof Error ? error.message : String(error));
    } finally {
      setVersionBusy(false);
    }
  }, [saveEndpoint, saveToken]);

  const restoreVersion = useCallback(async () => {
    if (!saveEndpoint || !saveToken || !restoreCandidate) return;
    setVersionBusy(true);
    setVersionError("");
    try {
      const baseHash = await ensureBoardSaved();
      if (!baseHash) throw new Error("請先完成本地儲存，再還原版本");
      const response = await fetch(`${saveEndpoint}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-board-token": saveToken },
        body: JSON.stringify({ revisionId: restoreCandidate, baseHash }),
      });
      const result = await response.json() as { error?: string; restored?: BoardConfig; sha256?: string; git?: SaveMeta["git"] };
      if (!response.ok || !result.restored || !result.sha256) throw new Error(result.error ?? `restore returned HTTP ${response.status}`);
      setRestoreCandidate(undefined);
      onRestored(result.restored, result.sha256, result.git);
    } catch (error) {
      setVersionError(error instanceof Error ? error.message : String(error));
      setVersionBusy(false);
    }
  }, [ensureBoardSaved, onRestored, restoreCandidate, saveEndpoint, saveToken]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveBoard();
      }
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, [saveBoard]);

  useEffect(() => {
    if (saveState !== "dirty" || !saveEndpoint || !saveToken) return;
    const timer = window.setTimeout(() => { void saveBoard(); }, 1_000);
    return () => window.clearTimeout(timer);
  }, [persistedSource, saveBoard, saveEndpoint, saveState, saveToken]);

  useEffect(() => {
    setNodes((current) => current.map((node) => {
      if (node.type === "debugNode") {
        const runtime = node.data.mode === "before" ? before : after;
        const runtimeData = debugData(flowConfigByMode, node.data.mode, node.data.nodeId, runtime, assetBase);
        return { ...node, data: { ...runtimeData, title: node.data.title, subtitle: node.data.subtitle } };
      }
      if (node.type === "playbackNode") {
        const runtime = node.data.mode === "before" ? before : after;
        const actions = node.data.mode === "before" ? beforeActions : afterActions;
        return { ...node, data: playbackData(flowConfigByMode, node.data.mode, runtime, actions) };
      }
      return node;
    }));
  }, [after, afterActions, assetBase, before, beforeActions, flowConfigByMode, setNodes]);

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
        data: { text: "輸入文字", autoFocus: true },
        draggable: true,
        zIndex: 2,
      };
    } else if (tool === "note") {
      node = {
        id,
        type: "noteNode",
        position: { x: point.x - 90, y: point.y - 58 },
        data: { text: "輸入除錯註記…", autoFocus: true },
        draggable: true,
        zIndex: 2,
      };
    } else {
      node = {
        id,
        type: "shapeNode",
        position: { x: point.x - 96, y: point.y - 48 },
        data: { text: "新的節點", autoFocus: true },
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

  const visualNodeCount = boardConfig.flows.reduce((count, flow) => count + flow.nodes.length, 0);
  const screenNodeCount = boardConfig.flows.reduce((count, flow) => count + flow.nodes.filter((node) => node.kind === "screen").length, 0);
  const edgeCount = boardConfig.flows.reduce((count, flow) => count + flow.edges.length, 0);

  return (
    <main
      className="canvas-app"
      data-board-ready={boardReady ? "true" : "false"}
      data-config-sha256={configHash}
      data-render-protocol={renderProtocol}
      data-service-node-count={visualNodeCount}
      data-screen-node-count={screenNodeCount}
      data-edge-count={edgeCount}
      data-label-count={edgeCount}
      data-save-bridge-state={saveBridgeState}
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
        aria-label={`${boardConfig.title} Difftale canvas`}
      >
        <Background gap={22} size={1.15} color="#d6d9dc" />
        <CanvasToolbar />
        <CreationToolbar tool={tool} onToolChange={setTool} />
        <BoardSavePanel
          enabled={saveBridgeState === "online"}
          state={saveState}
          meta={saveMeta}
          storageMode={storageMode}
          onSave={() => { void saveBoard(); }}
          onToggleVersions={toggleVersions}
          versionsOpen={versionPanelOpen}
        />
        <BoardVersionPanel
          open={versionPanelOpen}
          storageMode={storageMode}
          revisions={revisions}
          busy={versionBusy}
          error={versionError}
          title={versionTitle}
          selectedRevision={selectedRevision}
          diff={revisionDiff}
          restoreCandidate={restoreCandidate}
          onTitleChange={setVersionTitle}
          onCreate={() => { void createVersion(); }}
          onCompare={(revision) => { void compareVersion(revision); }}
          onRestoreRequest={(revision) => {
            setRestoreCandidate(revision.id);
            setSelectedRevision(revision.id);
            setRevisionDiff(undefined);
          }}
          onRestoreConfirm={() => { void restoreVersion(); }}
          onRestoreCancel={() => setRestoreCandidate(undefined)}
          onClose={() => setVersionPanelOpen(false)}
        />
      </ReactFlow>
      {saveBridgeState !== "online" ? (
        <div className="board-write-blocker" role="alert" data-testid="board-write-blocker" data-bridge-state={saveBridgeState}>
          <div>
            <strong>{saveBridgeState === "checking" ? "正在連接本地儲存…" : "目前無法安全編輯"}</strong>
            <span>
              {saveBridgeState === "missing"
                ? "這個網址缺少儲存連線。請重新執行 difftale launch，並使用完整 BOARD_URL。"
                : saveBridgeState === "offline"
                  ? "本地寫檔服務已離線。請重新執行 difftale launch，再從新的完整網址開啟。"
                  : "確認 Save Bridge 可寫入後，畫布會自動解除鎖定。"}
            </span>
          </div>
        </div>
      ) : null}
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
      const requestedSaveEndpoint = params.get("save") ?? undefined;
      const requestedSaveToken = params.get("saveToken") ?? undefined;
      const validSaveEndpoint = requestedSaveEndpoint && /^http:\/\/127\.0\.0\.1:\d+$/.test(requestedSaveEndpoint);
      const validSaveToken = requestedSaveToken && /^[a-f0-9]{48}$/.test(requestedSaveToken);
      if ((requestedSaveEndpoint || requestedSaveToken) && (!validSaveEndpoint || !validSaveToken)) throw new Error("Invalid local save session");

      if (!requestedHash) {
        setLoaded({ config: embeddedBoardConfig, configHash: "embedded", assetHash: "embedded", session: 0, finalStep, initialFlow, saveEndpoint: requestedSaveEndpoint, saveToken: requestedSaveToken, timeScale });
        return;
      }
      if (!/^[a-f0-9]{64}$/.test(requestedHash)) throw new Error("Invalid runtime config hash");

      const response = await fetch(`/runtime/${requestedHash}.json`, { cache: "no-store" });
      if (!response.ok) throw new Error(`Runtime config returned HTTP ${response.status}`);
      const source = await response.text();
      const actualHash = await sha256(source);
      if (actualHash !== requestedHash) throw new Error(`Runtime config hash mismatch: expected ${requestedHash}, received ${actualHash}`);
      setLoaded({ config: JSON.parse(source) as BoardConfig, configHash: requestedHash, assetHash: requestedHash, session: 0, finalStep, initialFlow, saveEndpoint: requestedSaveEndpoint, saveToken: requestedSaveToken, timeScale });
    };

    void load().catch((error: unknown) => setLoadError(error instanceof Error ? error.message : String(error)));
  }, []);

  if (loadError) {
    return <main className="canvas-app" data-board-ready="false" data-board-error={loadError} role="alert">{loadError}</main>;
  }
  if (!loaded) {
    return <main className="canvas-app" data-board-ready="false" aria-busy="true" />;
  }
  return (
    <BoardCanvas
      key={`${loaded.configHash}:${loaded.session}`}
      loaded={loaded}
      onRestored={(config, hash) => setLoaded((current) => current ? { ...current, config, configHash: hash, session: current.session + 1 } : current)}
    />
  );
}
