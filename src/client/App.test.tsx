// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConflictDetails,
  DiagramRecord,
  LibraryBackup,
  ProjectRecord,
} from '@shared/types';
import type { FlowchartCanvasV1 } from '@shared/flowchart-canvas-schema';
import { ApiClientError, type WorkbenchApi } from './api';
import { App } from './App';
import type { MermaidRenderer } from './use-mermaid-preview';

const editorDependencies = vi.hoisted(() => ({
  importMermaidFlowchart: vi.fn(),
  layoutImportedFlowchart: vi.fn(),
}));

vi.mock('./flowchart-import', () => ({
  importMermaidFlowchart: editorDependencies.importMermaidFlowchart,
}));

vi.mock('./flowchart-layout', () => ({
  layoutImportedFlowchart: editorDependencies.layoutImportedFlowchart,
}));

vi.mock('./components/FlowchartCanvas', () => ({
  FlowchartCanvas: ({
    canvas,
    sourceLayoutRevision,
    onCanvasChange,
    onCommit,
    onResetLayout,
  }: {
    canvas: FlowchartCanvasV1;
    sourceLayoutRevision?: number;
    onCanvasChange: (canvas: FlowchartCanvasV1) => void;
    onCommit: (canvas: FlowchartCanvasV1) => void;
    onResetLayout: () => void;
  }) => {
    const movedCanvas = {
      ...canvas,
      nodes: canvas.nodes.map((node, index) => (
        index === 0
          ? {
            ...node,
            position: {
              x: node.position.x + 100,
              y: node.position.y + 50,
            },
          }
          : node
      )),
    };
    return (
      <section aria-label="Interactive flowchart">
        <output data-testid="canvas-document">{JSON.stringify(canvas)}</output>
        <output data-testid="canvas-layout-revision">
          {sourceLayoutRevision ?? 0}
        </output>
        <button
          type="button"
          onClick={() => onCanvasChange(movedCanvas)}
        >
          Move idea locally
        </button>
        <button
          type="button"
          onClick={() => {
            onCanvasChange(movedCanvas);
            onCommit(movedCanvas);
          }}
        >
          Drag idea node
        </button>
        <button type="button" onClick={onResetLayout}>
          Reset layout
        </button>
      </section>
    );
  },
}));

const validRenderer: MermaidRenderer = async (source) => {
  if (source.includes('broken[')) {
    throw new Error('Parse error near broken');
  }
  return `<svg aria-label="Rendered diagram"><text>${source}</text></svg>`;
};

function createMemoryApi(initial?: {
  projects?: ProjectRecord[];
  diagrams?: DiagramRecord[];
}): WorkbenchApi & {
  projects: ProjectRecord[];
  diagrams: DiagramRecord[];
  failNextUpdate: boolean;
  conflictNextUpdate: boolean;
  updateCalls: number;
  updateInputs: Array<{
    title?: string;
    source?: string;
    canvas?: DiagramRecord['canvas'];
    version: number;
    force?: boolean;
  }>;
} {
  let sequence = 0;
  const now = '2026-07-29T12:00:00.000Z';
  const state = {
    projects: [...(initial?.projects ?? [])],
    diagrams: [...(initial?.diagrams ?? [])],
    failNextUpdate: false,
    conflictNextUpdate: false,
    updateCalls: 0,
    updateInputs: [] as Array<{
      title?: string;
      source?: string;
      canvas?: DiagramRecord['canvas'];
      version: number;
      force?: boolean;
    }>,
  };
  const nextId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;

  return Object.assign(state, {
    listLibrary: async () => ({
      projects: [...state.projects],
      diagrams: [...state.diagrams],
    }),
    createProject: async (name: string) => {
      const project: ProjectRecord = {
        id: nextId(),
        name,
        createdAt: now,
        updatedAt: now,
      };
      state.projects.push(project);
      return project;
    },
    renameProject: async (id: string, name: string) => {
      const project = state.projects.find((candidate) => candidate.id === id)!;
      const renamed = { ...project, name };
      state.projects = state.projects.map((candidate) =>
        candidate.id === id ? renamed : candidate,
      );
      return renamed;
    },
    deleteProject: async (id: string) => {
      const count = state.diagrams.filter(
        (diagram) => diagram.projectId === id,
      ).length;
      state.projects = state.projects.filter((project) => project.id !== id);
      state.diagrams = state.diagrams.filter(
        (diagram) => diagram.projectId !== id,
      );
      return { deletedProjectId: id, deletedDiagramCount: count };
    },
    createDiagram: async (
      projectId: string,
      title: string,
      source: string,
    ) => {
      const diagram: DiagramRecord = {
        id: nextId(),
        projectId,
        title,
        source,
        canvas: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      state.diagrams.push(diagram);
      return diagram;
    },
    getDiagram: async (id: string) =>
      state.diagrams.find((diagram) => diagram.id === id)!,
    updateDiagram: async (
      id: string,
      input: {
        title?: string;
        source?: string;
        canvas?: DiagramRecord['canvas'];
        version: number;
        force?: boolean;
      },
    ) => {
      state.updateCalls += 1;
      state.updateInputs.push(input);
      const current = state.diagrams.find((diagram) => diagram.id === id)!;
      if (state.failNextUpdate) {
        state.failNextUpdate = false;
        throw new ApiClientError(
          'The local server is unavailable.',
          0,
          'NETWORK_ERROR',
        );
      }
      if (state.conflictNextUpdate && !input.force) {
        state.conflictNextUpdate = false;
        const saved = {
          ...current,
          source: 'flowchart LR\n  Saved --> Elsewhere',
          version: current.version + 1,
        };
        state.diagrams = state.diagrams.map((diagram) =>
          diagram.id === id ? saved : diagram,
        );
        const submitted = { ...current, ...input };
        const details: ConflictDetails = { current: saved, submitted };
        throw new ApiClientError(
          'This diagram was updated by another request.',
          409,
          'VERSION_CONFLICT',
          details,
        );
      }
      const updated: DiagramRecord = {
        ...current,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.source === undefined ? {} : { source: input.source }),
        ...(input.canvas === undefined ? {} : { canvas: input.canvas }),
        version: current.version + 1,
        updatedAt: now,
      };
      state.diagrams = state.diagrams.map((diagram) =>
        diagram.id === id ? updated : diagram,
      );
      return updated;
    },
    duplicateDiagram: async (id: string) => {
      const source = state.diagrams.find((diagram) => diagram.id === id)!;
      const duplicate = {
        ...source,
        id: nextId(),
        title: `${source.title} copy`,
        version: 1,
      };
      state.diagrams.push(duplicate);
      return duplicate;
    },
    deleteDiagram: async (id: string) => {
      state.diagrams = state.diagrams.filter(
        (diagram) => diagram.id !== id,
      );
      return { deletedDiagramId: id };
    },
    exportDiagramUrl: (id: string) => `/api/diagrams/${id}/export`,
    exportBackupUrl: () => '/api/backup',
    restoreBackup: async (backup: LibraryBackup) => {
      state.projects = [...backup.projects];
      state.diagrams = backup.version === 1
        ? backup.diagrams.map((diagram) => ({ ...diagram, canvas: null }))
        : [...backup.diagrams];
      return { restored: true as const };
    },
  });
}

const project: ProjectRecord = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Launch maps',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: '2026-07-29T12:00:00.000Z',
};

const diagram: DiagramRecord = {
  id: '20000000-0000-4000-8000-000000000001',
  projectId: project.id,
  title: 'Release path',
  source: 'flowchart LR\n  Idea --> Ship',
  canvas: null,
  version: 1,
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: '2026-07-29T12:00:00.000Z',
};

const staticDiagram: DiagramRecord = {
  ...diagram,
  source: 'flowchart LR\n  subgraph Group\n    Idea --> Ship\n  end',
};

const importedGraph = {
  direction: 'LR' as const,
  nodes: [
    { id: 'idea', label: 'Idea', shape: 'rect' },
    { id: 'ship', label: 'Ship', shape: 'rect' },
  ],
  edges: [
    {
      id: 'edge|idea|ship|0',
      source: 'idea',
      target: 'ship',
      arrowStart: false,
      arrowEnd: true,
      lineStyle: 'solid' as const,
    },
  ],
  warnings: [],
};

function canvasAt(ideaX: number, ideaY: number): FlowchartCanvasV1 {
  return {
    kind: 'flowchart',
    version: 1,
    direction: 'LR',
    nodes: [
      {
        id: 'idea',
        label: 'Idea',
        shape: 'rect',
        position: { x: ideaX, y: ideaY },
      },
      {
        id: 'ship',
        label: 'Ship',
        shape: 'rect',
        position: { x: 400, y: 200 },
      },
    ],
    edges: importedGraph.edges,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe('App', () => {
  beforeEach(() => {
    editorDependencies.importMermaidFlowchart.mockReset();
    editorDependencies.layoutImportedFlowchart.mockReset();
    editorDependencies.importMermaidFlowchart.mockImplementation(
      async (source: string) => {
        if (source.startsWith('sequenceDiagram')) {
          return {
            status: 'unsupported',
            reason: 'Only Mermaid flowcharts support interactive mode.',
          };
        }
        if (source.includes('subgraph')) {
          return {
            status: 'unsupported',
            reason: 'Flowchart subgraphs are not supported in interactive mode.',
          };
        }
        return { status: 'compatible', graph: importedGraph };
      },
    );
    editorDependencies.layoutImportedFlowchart.mockImplementation(
      () => canvasAt(10, 20),
    );
    HTMLDialogElement.prototype.showModal ??= function showModal() {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close ??= function close() {
      this.removeAttribute('open');
    };
  });

  it('creates a first project and diagram from an honest empty state', async () => {
    const user = userEvent.setup();
    const client = createMemoryApi();
    render(<App client={client} renderDiagram={validRenderer} autosaveDelay={10} />);

    await screen.findByRole('button', { name: 'Create your first project' });
    await user.click(
      screen.getByRole('button', { name: 'Create your first project' }),
    );
    await user.type(screen.getByLabelText('Project name'), 'Launch maps');
    await user.click(screen.getByRole('button', { name: 'Create project' }));

    expect(
      await screen.findByRole('heading', { name: 'Launch maps' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'New diagram' }));
    await user.type(screen.getByLabelText('Diagram title'), 'Release path');
    await user.click(screen.getByRole('button', { name: 'Create diagram' }));

    expect(
      await screen.findByRole('heading', { name: 'Release path' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Mermaid source')).toBeInTheDocument();
  });

  it('renders an accessible workspace and autosaves valid source', async () => {
    const user = userEvent.setup();
    const client = createMemoryApi({
      projects: [project],
      diagrams: [staticDiagram],
    });
    render(<App client={client} renderDiagram={validRenderer} autosaveDelay={10} />);

    await user.click(await screen.findByRole('button', { name: 'Open Release path' }));
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Release path', level: 1 }),
    ).toBeInTheDocument();
    const source = screen.getByLabelText('Mermaid source');
    fireEvent.change(source, {
      target: { value: 'flowchart LR\n  Idea --> Build --> Ship' },
    });
    expect(screen.getByRole('status', { name: 'Save status' }))
      .toHaveTextContent('Unsaved changes');

    await waitFor(() => {
      expect(client.diagrams[0].source).toBe(
        'flowchart LR\n  Idea --> Build --> Ship',
      );
      expect(screen.getByRole('status', { name: 'Save status' }))
        .toHaveTextContent('Saved');
    });
    expect(
      await screen.findByTestId('mermaid-preview'),
    ).toContainHTML('Rendered diagram');
  });

  it('collapses source into a rail and restores the unchanged draft', async () => {
    const user = userEvent.setup();
    const client = createMemoryApi({
      projects: [project],
      diagrams: [diagram],
    });
    render(<App client={client} renderDiagram={validRenderer} autosaveDelay={10} />);

    await user.click(await screen.findByRole('button', { name: 'Open Release path' }));
    const source = screen.getByLabelText('Mermaid source');
    fireEvent.change(source, {
      target: { value: 'flowchart LR\n  Draft --> Preserved' },
    });
    await user.click(screen.getByRole('button', { name: 'Collapse source' }));

    const expand = screen.getByRole('button', { name: 'Expand source' });
    expect(expand).toHaveFocus();
    expect(screen.queryByLabelText('Mermaid source')).not.toBeInTheDocument();

    await user.click(expand);
    expect(screen.getByRole('button', { name: 'Collapse source' })).toHaveFocus();
    expect(screen.getByLabelText('Mermaid source')).toHaveValue(
      'flowchart LR\n  Draft --> Preserved',
    );
  });

  it('shows a source error marker while collapsed', async () => {
    const user = userEvent.setup();
    const client = createMemoryApi({
      projects: [project],
      diagrams: [staticDiagram],
    });
    render(<App client={client} renderDiagram={validRenderer} autosaveDelay={10} />);

    await user.click(await screen.findByRole('button', { name: 'Open Release path' }));
    const preview = await screen.findByTestId('mermaid-preview');
    await waitFor(() => expect(preview).toContainHTML('Idea --&gt; Ship'));
    fireEvent.change(screen.getByLabelText('Mermaid source'), {
      target: { value: 'flowchart LR\n  Idea --> broken[' },
    });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Parse error near broken',
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Collapse source' }));

    expect(screen.getByText('Source has a syntax error')).toBeInTheDocument();
    expect(preview).toContainHTML('Idea --&gt; Ship');
  });

  it('preserves the fitted preview transform through source collapse and later refits genuine resize', async () => {
    let resizeCallback: ResizeObserverCallback | null = null;
    const originalResizeObserver = globalThis.ResizeObserver;
    class TestResizeObserver implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }

      disconnect() {}
      observe() {}
      unobserve() {}
    }
    globalThis.ResizeObserver = TestResizeObserver;

    try {
      const user = userEvent.setup();
      const client = createMemoryApi({
        projects: [project],
        diagrams: [staticDiagram],
      });
      render(
        <App
          client={client}
          renderDiagram={async (source) =>
            `<svg viewBox="0 0 400 200"><text>${source}</text></svg>`
          }
          autosaveDelay={10}
        />,
      );

      await user.click(await screen.findByRole('button', { name: 'Open Release path' }));
      const canvas = await screen.findByTestId('mermaid-preview');
      await waitFor(() => expect(canvas).toContainHTML('Idea --&gt; Ship'));
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Fit diagram' })).toBeEnabled(),
      );
      const preview = screen.getByRole('region', { name: 'Diagram preview' });
      let size = { width: 1000, height: 700 };
      Object.defineProperty(preview, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          ...size,
          top: 0,
          left: 0,
          right: size.width,
          bottom: size.height,
          x: 0,
          y: 0,
          toJSON: () => undefined,
        }),
      });
      act(() => {
        resizeCallback?.([], {} as ResizeObserver);
      });
      const transform = screen.getByTestId('preview-transform');
      const fittedTransform = transform.style.transform;

      size = { width: 800, height: 600 };
      await user.click(screen.getByRole('button', { name: 'Collapse source' }));
      act(() => {
        resizeCallback?.([], {} as ResizeObserver);
      });
      expect(transform.style.transform).toBe(fittedTransform);

      size = { width: 1000, height: 700 };
      await user.click(screen.getByRole('button', { name: 'Expand source' }));
      act(() => {
        resizeCallback?.([], {} as ResizeObserver);
      });
      expect(transform.style.transform).toBe(fittedTransform);

      size = { width: 900, height: 650 };
      act(() => {
        resizeCallback?.([], {} as ResizeObserver);
      });
      expect(transform.style.transform).not.toBe(fittedTransform);
    } finally {
      globalThis.ResizeObserver = originalResizeObserver;
    }
  });

  it('preserves the last valid preview and does not save invalid source', async () => {
    const user = userEvent.setup();
    const client = createMemoryApi({
      projects: [project],
      diagrams: [staticDiagram],
    });
    render(<App client={client} renderDiagram={validRenderer} autosaveDelay={10} />);

    await user.click(await screen.findByRole('button', { name: 'Open Release path' }));
    const preview = await screen.findByTestId('mermaid-preview');
    await waitFor(() => expect(preview).toContainHTML('Idea --&gt; Ship'));
    const lastValid = preview.innerHTML;

    fireEvent.change(screen.getByLabelText('Mermaid source'), {
      target: { value: 'flowchart LR\n  Idea --> broken[' },
    });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Parse error near broken',
      ),
    );
    expect(preview.innerHTML).toBe(lastValid);
    expect(client.updateCalls).toBe(0);
  });

  it('offers retry after a failed save and explicit conflict choices', async () => {
    const user = userEvent.setup();
    const client = createMemoryApi({
      projects: [project],
      diagrams: [diagram],
    });
    client.failNextUpdate = true;
    render(<App client={client} renderDiagram={validRenderer} autosaveDelay={10} />);
    await user.click(await screen.findByRole('button', { name: 'Open Release path' }));

    fireEvent.change(screen.getByLabelText('Mermaid source'), {
      target: { value: 'flowchart LR\n  Retry --> Save' },
    });
    await user.click(await screen.findByRole('button', { name: 'Retry save' }));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Save status' }))
        .toHaveTextContent('Saved'),
    );

    client.conflictNextUpdate = true;
    fireEvent.change(screen.getByLabelText('Mermaid source'), {
      target: { value: 'flowchart LR\n  Mine --> Version' },
    });
    expect(
      await screen.findByRole('heading', {
        name: 'Choose which version to keep',
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Keep my version' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Use saved version' }),
    ).toBeInTheDocument();
  });

  it('imports a compatible legacy flowchart transiently and persists only committed positions with the saved version', async () => {
    const user = userEvent.setup();
    const client = createMemoryApi({
      projects: [project],
      diagrams: [diagram],
    });
    render(<App client={client} renderDiagram={validRenderer} autosaveDelay={10} />);

    await user.click(await screen.findByRole('button', { name: 'Open Release path' }));
    expect(
      await screen.findByRole('region', { name: 'Interactive flowchart' }),
    ).toBeInTheDocument();
    expect(client.updateCalls).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Drag idea node' }));
    await waitFor(() => expect(client.updateCalls).toBe(1));
    expect(client.updateInputs[0]).toMatchObject({
      version: 1,
      canvas: canvasAt(110, 70),
    });
    expect(client.diagrams[0].canvas).toEqual(canvasAt(110, 70));

    await user.click(screen.getByRole('button', { name: 'Drag idea node' }));
    await waitFor(() => expect(client.updateCalls).toBe(2));
    expect(client.updateInputs[1]).toMatchObject({
      version: 2,
      canvas: canvasAt(210, 120),
    });
  });

  it('keeps in-progress canvas movement local until the canvas commits', async () => {
    const user = userEvent.setup();
    const client = createMemoryApi({
      projects: [project],
      diagrams: [{ ...diagram, canvas: canvasAt(10, 20) }],
    });
    render(<App client={client} renderDiagram={validRenderer} autosaveDelay={10} />);

    await user.click(await screen.findByRole('button', { name: 'Open Release path' }));
    await user.click(screen.getByRole('button', { name: 'Move idea locally' }));
    expect(screen.getByTestId('canvas-document')).toHaveTextContent(
      JSON.stringify(canvasAt(110, 70)),
    );
    expect(screen.getByRole('status', { name: 'Save status' }))
      .toHaveTextContent('Saved');
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    expect(client.updateCalls).toBe(0);
  });

  it.each([
    {
      name: 'sequence diagram',
      source: 'sequenceDiagram\n  Alice->>Bob: Hello',
      reason: 'Only Mermaid flowcharts support interactive mode.',
    },
    {
      name: 'subgraph flowchart',
      source: 'flowchart LR\n  subgraph Group\n    Idea --> Ship\n  end',
      reason: 'Flowchart subgraphs are not supported in interactive mode.',
    },
  ])('keeps the static source and preview for an unsupported $name', async ({
    source,
    reason,
  }) => {
    const user = userEvent.setup();
    const unsupported = { ...diagram, source };
    const client = createMemoryApi({
      projects: [project],
      diagrams: [unsupported],
    });
    render(<App client={client} renderDiagram={validRenderer} autosaveDelay={10} />);

    await user.click(await screen.findByRole('button', { name: 'Open Release path' }));
    expect(await screen.findByLabelText('Mermaid source')).toHaveValue(source);
    const preview = await screen.findByTestId('mermaid-preview');
    await waitFor(() => expect(preview).toContainHTML('Rendered diagram'));
    expect(screen.getByText('Interactive layout unavailable')).toBeInTheDocument();
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(screen.getByText(reason)).not.toHaveAttribute('role', 'alert');
  });

  it('uses a validated saved canvas immediately and preserves exact positions across source collapse', async () => {
    const user = userEvent.setup();
    const savedCanvas = canvasAt(137.5, -42);
    const client = createMemoryApi({
      projects: [project],
      diagrams: [{ ...diagram, canvas: savedCanvas }],
    });
    render(<App client={client} renderDiagram={validRenderer} autosaveDelay={10} />);

    await user.click(await screen.findByRole('button', { name: 'Open Release path' }));
    expect(await screen.findByTestId('canvas-document')).toHaveTextContent(
      JSON.stringify(savedCanvas),
    );
    expect(editorDependencies.importMermaidFlowchart).not.toHaveBeenCalled();
    expect(editorDependencies.layoutImportedFlowchart).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Collapse source' }));
    await user.click(screen.getByRole('button', { name: 'Expand source' }));
    expect(screen.getByTestId('canvas-document')).toHaveTextContent(
      JSON.stringify(savedCanvas),
    );
    expect(editorDependencies.layoutImportedFlowchart).not.toHaveBeenCalled();
  });

  it('cancels reset without changing positions, then confirms automatic layout, fits, and saves once', async () => {
    const user = userEvent.setup();
    const manualCanvas = canvasAt(900, 700);
    const automaticCanvas = canvasAt(10, 20);
    const client = createMemoryApi({
      projects: [project],
      diagrams: [{ ...diagram, canvas: manualCanvas }],
    });
    const confirm = vi.spyOn(window, 'confirm')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    render(<App client={client} renderDiagram={validRenderer} autosaveDelay={10} />);

    await user.click(await screen.findByRole('button', { name: 'Open Release path' }));
    await user.click(screen.getByRole('button', { name: 'Reset layout' }));
    expect(confirm).toHaveBeenLastCalledWith(
      'Reset all manually positioned nodes to an automatic layout?',
    );
    expect(screen.getByTestId('canvas-document')).toHaveTextContent(
      JSON.stringify(manualCanvas),
    );
    expect(client.updateCalls).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Reset layout' }));
    expect(editorDependencies.importMermaidFlowchart).toHaveBeenCalledWith(
      diagram.source,
    );
    await waitFor(() =>
      expect(screen.getByTestId('canvas-document')).toHaveTextContent(
        JSON.stringify(automaticCanvas),
      ),
    );
    expect(screen.getByTestId('canvas-layout-revision')).toHaveTextContent('1');
    await waitFor(() => expect(client.updateCalls).toBe(1));
    expect(client.updateInputs[0]?.canvas).toEqual(automaticCanvas);
  });

  it('retains failed local positions and retries the complete canvas', async () => {
    const user = userEvent.setup();
    const client = createMemoryApi({
      projects: [project],
      diagrams: [{ ...diagram, canvas: canvasAt(10, 20) }],
    });
    client.failNextUpdate = true;
    render(<App client={client} renderDiagram={validRenderer} autosaveDelay={10} />);

    await user.click(await screen.findByRole('button', { name: 'Open Release path' }));
    await user.click(screen.getByRole('button', { name: 'Drag idea node' }));
    await screen.findByRole('button', { name: 'Retry save' });
    expect(screen.getByTestId('canvas-document')).toHaveTextContent(
      JSON.stringify(canvasAt(110, 70)),
    );

    await user.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(client.updateCalls).toBe(2));
    expect(client.updateInputs[1]?.canvas).toEqual(canvasAt(110, 70));
  });

  it('replaces local positions with the saved conflict choice without rendering canvas JSON', async () => {
    const user = userEvent.setup();
    const savedCanvas = canvasAt(10, 20);
    const client = createMemoryApi({
      projects: [project],
      diagrams: [{ ...diagram, canvas: savedCanvas }],
    });
    client.conflictNextUpdate = true;
    render(<App client={client} renderDiagram={validRenderer} autosaveDelay={10} />);

    await user.click(await screen.findByRole('button', { name: 'Open Release path' }));
    await user.click(screen.getByRole('button', { name: 'Drag idea node' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('2 nodes · 1 edges');
    expect(dialog).not.toHaveTextContent('"kind":"flowchart"');
    await user.click(screen.getByRole('button', { name: 'Use saved version' }));

    expect(screen.getByTestId('canvas-document')).toHaveTextContent(
      JSON.stringify(savedCanvas),
    );
  });

  it('force-saves the complete local canvas after a conflict', async () => {
    const user = userEvent.setup();
    const client = createMemoryApi({
      projects: [project],
      diagrams: [{ ...diagram, canvas: canvasAt(10, 20) }],
    });
    client.conflictNextUpdate = true;
    render(<App client={client} renderDiagram={validRenderer} autosaveDelay={10} />);

    await user.click(await screen.findByRole('button', { name: 'Open Release path' }));
    await user.click(screen.getByRole('button', { name: 'Drag idea node' }));
    await screen.findByRole('dialog');
    await user.click(screen.getByRole('button', { name: 'Keep my version' }));

    await waitFor(() => expect(client.updateCalls).toBe(2));
    expect(client.updateInputs[1]).toMatchObject({
      canvas: canvasAt(110, 70),
      force: true,
      version: 2,
    });
  });

  it('ignores a stale compatible import after switching to another diagram', async () => {
    const user = userEvent.setup();
    const firstImport = deferred<{
      status: 'compatible';
      graph: typeof importedGraph;
    }>();
    const secondImport = deferred<{
      status: 'compatible';
      graph: typeof importedGraph;
    }>();
    editorDependencies.importMermaidFlowchart
      .mockReturnValueOnce(firstImport.promise)
      .mockReturnValueOnce(secondImport.promise);
    editorDependencies.layoutImportedFlowchart.mockImplementation(
      (graph: typeof importedGraph) => (
        graph.nodes[0]?.label === 'Second'
          ? canvasAt(222, 20)
          : canvasAt(111, 20)
      ),
    );
    const client = createMemoryApi({
      projects: [project],
      diagrams: [diagram],
    });
    render(<App client={client} renderDiagram={validRenderer} autosaveDelay={10} />);

    await user.click(await screen.findByRole('button', { name: 'Open Release path' }));
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    secondImport.resolve({
      status: 'compatible',
      graph: {
        ...importedGraph,
        nodes: importedGraph.nodes.map((node, index) => (
          index === 0 ? { ...node, label: 'Second' } : node
        )),
      },
    });
    expect(await screen.findByTestId('canvas-document')).toHaveTextContent(
      JSON.stringify(canvasAt(222, 20)),
    );

    firstImport.resolve({ status: 'compatible', graph: importedGraph });
    await act(async () => {
      await firstImport.promise;
    });
    expect(screen.getByTestId('canvas-document')).toHaveTextContent(
      JSON.stringify(canvasAt(222, 20)),
    );
  });
});
