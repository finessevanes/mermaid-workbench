import { describe, expect, it } from 'vitest';
import {
  validateFlowchartCanvas,
  type FlowchartCanvasV1,
} from './flowchart-canvas-schema';

const validCanvas = {
  kind: 'flowchart',
  version: 1,
  direction: 'LR',
  nodes: [
    {
      id: 'idea',
      label: 'Idea',
      shape: 'rect',
      position: { x: 40, y: 80 },
    },
    {
      id: 'ship',
      label: 'Ship',
      shape: 'circle',
      position: { x: 340, y: 80 },
    },
  ],
  edges: [
    {
      id: 'idea-ship-0',
      source: 'idea',
      target: 'ship',
      arrowStart: false,
      arrowEnd: true,
      lineStyle: 'solid',
    },
  ],
} satisfies FlowchartCanvasV1;

describe('validateFlowchartCanvas', () => {
  it('parses a valid version 1 flowchart canvas', () => {
    expect(validateFlowchartCanvas(validCanvas)).toEqual(validCanvas);
  });

  it.each([
    ['an unsupported version', { ...validCanvas, version: 2 }],
    [
      'duplicate node IDs',
      { ...validCanvas, nodes: [...validCanvas.nodes, validCanvas.nodes[0]] },
    ],
    [
      'duplicate edge IDs',
      { ...validCanvas, edges: [...validCanvas.edges, validCanvas.edges[0]] },
    ],
    [
      'non-finite node positions',
      {
        ...validCanvas,
        nodes: [{ ...validCanvas.nodes[0], position: { x: NaN, y: 0 } }],
      },
    ],
    [
      'dangling edge endpoints',
      { ...validCanvas, edges: [{ ...validCanvas.edges[0], target: 'missing' }] },
    ],
  ])('rejects %s', (_description, invalidCanvas) => {
    expect(() => validateFlowchartCanvas(invalidCanvas)).toThrow();
  });
});
