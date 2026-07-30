// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { importMermaidFlowchart } from './flowchart-import';

describe('importMermaidFlowchart', () => {
  it('normalizes a real Mermaid flowchart into stable Workbench graph data', async () => {
    const result = await importMermaidFlowchart(`flowchart LR
  idea[Idea] -->|refine| decision{Ready?}
  decision -.-> ship((Ship))`);

    expect(result).toEqual({
      status: 'compatible',
      graph: {
        direction: 'LR',
        nodes: [
          { id: 'idea', label: 'Idea', shape: 'squareRect' },
          { id: 'decision', label: 'Ready?', shape: 'diamond' },
          { id: 'ship', label: 'Ship', shape: 'circle' },
        ],
        edges: [
          {
            id: 'idea-decision-0',
            source: 'idea',
            target: 'decision',
            label: 'refine',
            arrowStart: false,
            arrowEnd: true,
            lineStyle: 'solid',
          },
          {
            id: 'decision-ship-0',
            source: 'decision',
            target: 'ship',
            arrowStart: false,
            arrowEnd: true,
            lineStyle: 'dotted',
          },
        ],
        warnings: [],
      },
    });
  });

  it('assigns distinct deterministic IDs to parallel edges', async () => {
    const source = `flowchart TB
  source --> target
  source --> target`;

    const first = await importMermaidFlowchart(source);
    const second = await importMermaidFlowchart(source);

    expect(first).toMatchObject({
      status: 'compatible',
      graph: {
        edges: [
          { id: 'source-target-0', source: 'source', target: 'target' },
          { id: 'source-target-1', source: 'source', target: 'target' },
        ],
      },
    });
    expect(second).toEqual(first);
  });

  it('maps every Mermaid line style without collapsing arrow metadata', async () => {
    const result = await importMermaidFlowchart(`flowchart TB
  A --- B
  A -.-> C
  A ==> D
  A ~~~ E`);

    expect(result).toMatchObject({
      status: 'compatible',
      graph: {
        edges: [
          { lineStyle: 'solid', arrowStart: false, arrowEnd: false },
          { lineStyle: 'dotted', arrowStart: false, arrowEnd: true },
          { lineStyle: 'thick', arrowStart: false, arrowEnd: true },
          { lineStyle: 'invisible', arrowStart: false, arrowEnd: false },
        ],
      },
    });
  });

  it('retains an unrecognized shape token and reports its visual fallback', async () => {
    const result = await importMermaidFlowchart(`flowchart TB
  weather@{ shape: cloud, label: "Weather" }`);

    expect(result).toMatchObject({
      status: 'compatible',
      graph: {
        nodes: [{ id: 'weather', label: 'Weather', shape: 'cloud' }],
        warnings: [{ code: 'SHAPE_FALLBACK', nodeId: 'weather' }],
      },
    });
  });

  it.each([
    ['a non-flowchart diagram', `sequenceDiagram\n  Alice->>Bob: Hello`],
    [
      'subgraphs',
      `flowchart LR
  subgraph Group
    A --> B
  end`,
    ],
    [
      'click handlers',
      `flowchart LR
  A --> B
  click A callback`,
    ],
    ['HTML labels', `flowchart LR\n  A["<strong>Hello</strong>"] --> B`],
  ])('rejects %s as unsupported', async (_caseName, source) => {
    const result = await importMermaidFlowchart(source);

    expect(result).toEqual({
      status: 'unsupported',
      reason: expect.any(String),
    });
    if (result.status === 'unsupported') {
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });

  it('returns unsupported instead of throwing for invalid Mermaid syntax', async () => {
    await expect(
      importMermaidFlowchart(`flowchart LR
  A --> broken[`),
    ).resolves.toEqual({
      status: 'unsupported',
      reason: expect.any(String),
    });
  });
});
