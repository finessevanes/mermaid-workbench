export function projectDeletionMessage(
  projectName: string,
  diagramCount: number,
): string {
  if (diagramCount === 0) {
    return `Delete empty project “${projectName}”? This cannot be undone.`;
  }
  const noun = diagramCount === 1 ? 'diagram' : 'diagrams';
  return `Delete “${projectName}” and its ${diagramCount} ${noun}? This cannot be undone.`;
}

export function diagramDeletionMessage(diagramTitle: string): string {
  return `Delete diagram “${diagramTitle}”? This cannot be undone.`;
}
