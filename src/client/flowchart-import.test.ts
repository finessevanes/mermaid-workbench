// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  importMermaidFlowchart,
  normalizeMermaidFlowchartDiagram,
} from './flowchart-import';

function parsedFlowchartModel({
  type = 'flowchart-v2',
  nodes = [
    { id: 'A', label: 'A', shape: 'squareRect' },
    { id: 'B', label: 'B', shape: 'squareRect' },
  ],
  edges = [],
}: {
  type?: string;
  nodes?: Record<string, unknown>[];
  edges?: Record<string, unknown>[];
}) {
  return {
    type,
    db: {
      getDirection: () => 'TB',
      getSubGraphs: () => [],
      getData: () => ({ nodes, edges }),
    },
  };
}

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
            id: 'edge|idea|decision|0',
            source: 'idea',
            target: 'decision',
            label: 'refine',
            arrowStart: false,
            arrowEnd: true,
            lineStyle: 'solid',
          },
          {
            id: 'edge|decision|ship|0',
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
          { id: 'edge|source|target|0', source: 'source', target: 'target' },
          { id: 'edge|source|target|1', source: 'source', target: 'target' },
        ],
      },
    });
    expect(second).toEqual(first);
  });

  it('keeps edge IDs distinct when endpoint IDs contain delimiter characters', async () => {
    const result = await importMermaidFlowchart(`flowchart LR
  a-b --> c
  a --> b-c`);

    expect(result).toMatchObject({
      status: 'compatible',
      graph: {
        edges: [
          { id: 'edge|a-b|c|0', source: 'a-b', target: 'c' },
          { id: 'edge|a|b-c|0', source: 'a', target: 'b-c' },
        ],
      },
    });
  });

  it('admits the graph source alias through the reviewed flowchart model', async () => {
    const result = await importMermaidFlowchart(`graph RL
  start --> finish`);

    expect(result).toMatchObject({
      status: 'compatible',
      graph: {
        direction: 'RL',
        nodes: [{ id: 'start' }, { id: 'finish' }],
        edges: [
          {
            id: 'edge|start|finish|0',
            source: 'start',
            target: 'finish',
          },
        ],
      },
    });
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
    ['HTML edge labels', `flowchart LR\n  A -->|<strong>Hello</strong>| B`],
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

  it.each([
    ['a malformed flowchart', `flowchart LR\n  A --> broken[`],
    ['empty input', ''],
    ['nonsense input', 'this is not Mermaid'],
  ])('returns a structured invalid-syntax result for %s', async (
    _caseName,
    source,
  ) => {
    await expect(
      importMermaidFlowchart(source),
    ).resolves.toEqual({
      status: 'unsupported',
      reason: expect.any(String),
      code: 'INVALID_SYNTAX',
    });
  });

  it('rejects model node IDs longer than the shared schema limit', async () => {
    const longNodeId = `node${'a'.repeat(237)}`;

    const result = await importMermaidFlowchart(`flowchart TB
  ${longNodeId}`);

    expect(result).toEqual({
      status: 'unsupported',
      reason: expect.any(String),
    });
  });

  it('rejects constructed edge IDs longer than the shared schema limit', async () => {
    const sourceId = `source${'a'.repeat(111)}`;
    const targetId = `target${'b'.repeat(110)}`;

    const result = await importMermaidFlowchart(`flowchart TB
  ${sourceId} --> ${targetId}`);

    expect(result).toEqual({
      status: 'unsupported',
      reason: expect.any(String),
    });
  });
});

describe('normalizeMermaidFlowchartDiagram runtime guards', () => {
  it.each([
    [
      'non-string node labels',
      parsedFlowchartModel({
        nodes: [{ id: 'A', label: 42, shape: 'squareRect' }],
      }),
    ],
    [
      'non-string node shapes',
      parsedFlowchartModel({
        nodes: [{ id: 'A', label: 'A', shape: 42 }],
      }),
    ],
    [
      'non-string edge labels',
      parsedFlowchartModel({
        edges: [
          {
            start: 'A',
            end: 'B',
            label: 42,
            arrowTypeStart: 'none',
            arrowTypeEnd: 'arrow_point',
            thickness: 'normal',
          },
        ],
      }),
    ],
    [
      'prototype-inherited line style names',
      parsedFlowchartModel({
        edges: [
          {
            start: 'A',
            end: 'B',
            label: '',
            arrowTypeStart: 'none',
            arrowTypeEnd: 'arrow_point',
            thickness: 'toString',
          },
        ],
      }),
    ],
  ])('fails closed for %s', (_caseName, diagram) => {
    expect(normalizeMermaidFlowchartDiagram(diagram)).toEqual({
      status: 'unsupported',
      reason: expect.any(String),
    });
  });

  it('rejects unreviewed flowchart-like Mermaid model types', () => {
    expect(
      normalizeMermaidFlowchartDiagram(
        parsedFlowchartModel({ type: 'flowchart-future' }),
      ),
    ).toEqual({
      status: 'unsupported',
      reason: expect.any(String),
    });
  });
});
