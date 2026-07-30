import { useEffect, useMemo, useState } from 'react';
import type { FlowchartCanvasV1 } from '../../shared/flowchart-canvas-schema';
import {
  importMermaidFlowchart,
  type FlowchartImportResult,
} from '../flowchart-import';
import {
  reconcileFlowchartImport,
  type ReconciliationSummary,
} from '../flowchart-layout';

export interface MermaidImportPanelProps {
  source: string;
  canvas: FlowchartCanvasV1;
  onApply: (result: {
    source: string;
    canvas: FlowchartCanvasV1;
    summary: ReconciliationSummary;
  }) => void;
}

type ImportState =
  | { mode: 'view' }
  | { mode: 'edit'; source: string; checking: boolean; result: null }
  | {
    mode: 'edit';
    source: string;
    checking: false;
    result: FlowchartImportResult;
  };

function isSyntaxError(reason: string) {
  return /\b(parse|syntax|lexical)\b/i.test(reason);
}

export function MermaidImportPanel({
  source,
  canvas,
  onApply,
}: MermaidImportPanelProps) {
  const [importState, setImportState] = useState<ImportState>({ mode: 'view' });
  const [copyStatus, setCopyStatus] = useState<'Copied' | 'Copy failed' | null>(
    null,
  );

  useEffect(() => {
    if (importState.mode !== 'edit' || !importState.checking) {
      return;
    }
    let active = true;
    const stagedSource = importState.source;
    const timeout = window.setTimeout(() => {
      void importMermaidFlowchart(stagedSource).then((result) => {
        if (!active) {
          return;
        }
        setImportState({
          mode: 'edit',
          source: stagedSource,
          checking: false,
          result,
        });
      });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [importState]);

  const reconciliation = useMemo(() => {
    if (
      importState.mode !== 'edit' ||
      importState.checking ||
      importState.result?.status !== 'compatible'
    ) {
      return null;
    }
    try {
      return reconcileFlowchartImport(canvas, importState.result.graph);
    } catch {
      return null;
    }
  }, [canvas, importState]);

  const displayedSource = importState.mode === 'edit'
    ? importState.source
    : source;
  const unsupportedReason =
    importState.mode === 'edit' &&
    !importState.checking &&
    importState.result?.status === 'unsupported'
      ? importState.result.reason
      : null;

  const copyMermaid = async () => {
    try {
      await navigator.clipboard.writeText(displayedSource);
      setCopyStatus('Copied');
    } catch {
      setCopyStatus('Copy failed');
    }
  };

  const applyImport = () => {
    if (
      importState.mode !== 'edit' ||
      !reconciliation
    ) {
      return;
    }
    if (
      reconciliation.summary.removed > 0 &&
      !window.confirm(
        `This import removes ${reconciliation.summary.removed} node(s) from the visual canvas. Apply it?`,
      )
    ) {
      return;
    }
    const stagedSource = importState.source;
    setImportState({ mode: 'view' });
    onApply({
      source: stagedSource,
      canvas: reconciliation.canvas,
      summary: reconciliation.summary,
    });
  };

  return (
    <div
      className="mermaid-import"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <label className="source-editor mermaid-import__source">
        <span>Mermaid source</span>
        <textarea
          value={displayedSource}
          readOnly={importState.mode === 'view'}
          spellCheck={false}
          onChange={(event) => {
            setCopyStatus(null);
            setImportState({
              mode: 'edit',
              source: event.currentTarget.value,
              checking: true,
              result: null,
            });
          }}
        />
      </label>

      {importState.mode === 'view' ? (
        <p className="mermaid-import__note">
          Moving nodes changes only the visual layout. Mermaid source stays
          unchanged until you apply an import.
        </p>
      ) : (
        <div className="mermaid-import__compatibility">
          {importState.checking ? (
            <p role="status">Checking compatibility…</p>
          ) : unsupportedReason ? (
            <p className="mermaid-import__message mermaid-import__message--error" role="alert">
              <strong>
                {isSyntaxError(unsupportedReason)
                  ? 'Mermaid syntax error'
                  : 'Not compatible'}
              </strong>
              <span>{unsupportedReason}</span>
            </p>
          ) : reconciliation ? (
            <div
              className="mermaid-import__summary"
              aria-label="Import reconciliation"
            >
              <span>{reconciliation.summary.added} added</span>
              <span>{reconciliation.summary.removed} removed</span>
              <span>{reconciliation.summary.preserved} preserved</span>
            </div>
          ) : (
            <p className="mermaid-import__message mermaid-import__message--error" role="alert">
              <strong>Not compatible</strong>
              <span>The imported flowchart could not be laid out safely.</span>
            </p>
          )}
        </div>
      )}

      <div className="mermaid-import__actions">
        {importState.mode === 'view' ? (
          <button
            type="button"
            className="button button--secondary"
            onClick={() => {
              setCopyStatus(null);
              setImportState({
                mode: 'edit',
                source,
                checking: true,
                result: null,
              });
            }}
          >
            Edit import
          </button>
        ) : (
          <>
            <button
              type="button"
              className="button button--primary"
              disabled={!reconciliation}
              onClick={applyImport}
            >
              Apply import
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                setCopyStatus(null);
                setImportState({ mode: 'view' });
              }}
            >
              Cancel
            </button>
          </>
        )}
        <button
          type="button"
          className="button button--quiet"
          onClick={() => void copyMermaid()}
        >
          Copy Mermaid
        </button>
        {copyStatus ? (
          <span className="mermaid-import__copy-status" role="status">
            {copyStatus}
          </span>
        ) : null}
      </div>
    </div>
  );
}
