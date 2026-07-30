let initialized = false;

export async function getMermaid() {
  const { default: mermaid } = await import('mermaid');
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: {
        primaryColor: '#e9efff',
        primaryBorderColor: '#2f5ee5',
        primaryTextColor: '#111a2d',
        lineColor: '#526078',
        secondaryColor: '#fff4d6',
        tertiaryColor: '#f4f6fa',
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      },
    });
    initialized = true;
  }
  return mermaid;
}
