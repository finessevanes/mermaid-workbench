import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  validateFlowchartCanvas,
  type FlowchartCanvasV1,
} from '../../shared/flowchart-canvas-schema';
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

export function MermaidImportPanel({
  source,
  canvas,
  onApply,
}: MermaidImportPanelProps) {
  const [importState, setImportState] = useState<ImportState>({ mode: 'view' });
  const [copyStatus, setCopyStatus] = useState<'Copied' | 'Copy failed' | null>(
    null,
  );
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const sourceTextareaRef = useRef<HTMLTextAreaElement>(null);
  const returnFocusToEditRef = useRef(false);

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
      const result = reconcileFlowchartImport(
        canvas,
        importState.result.graph,
      );
      return {
        status: 'ready' as const,
        canvas: validateFlowchartCanvas(result.canvas),
        summary: result.summary,
      };
    } catch {
      return { status: 'invalid' as const };
    }
  }, [canvas, importState]);

  useLayoutEffect(() => {
    if (importState.mode === 'edit') {
      sourceTextareaRef.current?.focus();
      return;
    }
    if (returnFocusToEditRef.current) {
      returnFocusToEditRef.current = false;
      editButtonRef.current?.focus();
    }
  }, [importState.mode]);

  const displayedSource = importState.mode === 'edit'
    ? importState.source
    : source;
  const unsupportedResult =
    importState.mode === 'edit' &&
    !importState.checking &&
    importState.result?.status === 'unsupported'
      ? importState.result
      : null;
  const readyReconciliation =
    reconciliation?.status === 'ready' ? reconciliation : null;

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
      !readyReconciliation
    ) {
      return;
    }
    if (
      readyReconciliation.summary.removed > 0 &&
      !window.confirm(
        `This import removes ${readyReconciliation.summary.removed} node(s) from the visual canvas. Apply it?`,
      )
    ) {
      return;
    }
    const stagedSource = importState.source;
    returnFocusToEditRef.current = true;
    setImportState({ mode: 'view' });
    onApply({
      source: stagedSource,
      canvas: readyReconciliation.canvas,
      summary: readyReconciliation.summary,
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
          ref={sourceTextareaRef}
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
          ) : unsupportedResult ? (
            <p className="mermaid-import__message mermaid-import__message--error" role="alert">
              <strong>
                {unsupportedResult.code === 'INVALID_SYNTAX'
                  ? 'Mermaid syntax error'
                  : 'Not compatible'}
              </strong>
              <span>{unsupportedResult.reason}</span>
            </p>
          ) : readyReconciliation ? (
            <div
              className="mermaid-import__summary"
              aria-label="Import reconciliation"
              aria-live="polite"
              role="status"
            >
              <span>{readyReconciliation.summary.added} added</span>
              <span>{readyReconciliation.summary.removed} removed</span>
              <span>{readyReconciliation.summary.preserved} preserved</span>
            </div>
          ) : (
            <p className="mermaid-import__message mermaid-import__message--error" role="alert">
              <strong>Import validation failed</strong>
              <span>
                This import could not be validated safely. The current canvas
                is unchanged.
              </span>
            </p>
          )}
        </div>
      )}

      <div className="mermaid-import__actions">
        {importState.mode === 'view' ? (
          <button
            ref={editButtonRef}
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
              disabled={!readyReconciliation}
              onClick={applyImport}
            >
              Apply import
            </button>
            <button
              type="button"
              className="button button--quiet"
              onClick={() => {
                setCopyStatus(null);
                returnFocusToEditRef.current = true;
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
