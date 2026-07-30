// @vitest-environment jsdom

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  ConflictDetails,
  DiagramRecord,
  LibraryBackup,
  ProjectRecord,
} from '@shared/types';
import { ApiClientError, type WorkbenchApi } from './api';
import { App } from './App';
import type { MermaidRenderer } from './use-mermaid-preview';

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
} {
  let sequence = 0;
  const now = '2026-07-29T12:00:00.000Z';
  const state = {
    projects: [...(initial?.projects ?? [])],
    diagrams: [...(initial?.diagrams ?? [])],
    failNextUpdate: false,
    conflictNextUpdate: false,
    updateCalls: 0,
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

describe('App', () => {
  beforeEach(() => {
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
      diagrams: [diagram],
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
      diagrams: [diagram],
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
        diagrams: [diagram],
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
      diagrams: [diagram],
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
});
