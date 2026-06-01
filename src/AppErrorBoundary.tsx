import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "./observability/errorSink";

/**
 * Top-level error boundary. Catches render-time crashes (including
 * the kind that come out of an unguarded `localStorage` access in
 * Safari private mode, or a WASM module that fails its first
 * `mod.x()` call) and shows the user a recovery prompt instead of
 * the default React blank page.
 *
 * Reload, copy-error, and clear-storage are the three actions a user
 * can take without dev tools. The error message and component stack
 * are displayed verbatim so a power user can paste them in a bug
 * report.
 */

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
  componentStack: string | null;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    reportError("AppErrorBoundary", error, {
      componentStack: info.componentStack ?? null,
    });
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleClearAndReload = (): void => {
    try {
      window.localStorage.clear();
    } catch {
      // Storage might be the cause of the crash; ignore failure here
      // and fall through to the reload, which still gets the user to
      // a fresh attempt.
    }
    window.location.reload();
  };

  private handleCopy = async (): Promise<void> => {
    const { error, componentStack } = this.state;
    if (!error) return;
    const text = [
      `Error: ${error.message}`,
      "",
      "Stack:",
      error.stack ?? "(none)",
      "",
      "Component stack:",
      componentStack ?? "(none)",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard access may be denied in iframes / older browsers.
      // Fall back to a prompt() so the user can copy by hand.
      window.prompt("Copy the error report below:", text);
    }
  };

  render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          maxWidth: 720,
          margin: "10vh auto",
          padding: "1.5rem",
          fontFamily: "system-ui, sans-serif",
          color: "#eee",
          background: "#1d1f24",
          borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
          lineHeight: 1.45,
        }}
      >
        <h1 style={{ marginTop: 0, fontSize: "1.4rem" }}>
          Something broke loading this page.
        </h1>
        <p>
          The site hit an unexpected error. Reloading usually fixes it; if
          it persists, try clearing local data, or copy the report below
          and let us know.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "1rem 0" }}>
          <button onClick={this.handleReload}>Reload</button>
          <button onClick={this.handleClearAndReload}>Clear local data + reload</button>
          <button onClick={this.handleCopy}>Copy error report</button>
        </div>
        <details style={{ marginTop: "1rem" }}>
          <summary style={{ cursor: "pointer" }}>Technical details</summary>
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: "#11131a",
              padding: "0.75rem",
              borderRadius: 4,
              fontSize: "0.85rem",
              maxHeight: "40vh",
              overflow: "auto",
            }}
          >
            {error.message}
            {error.stack ? `\n\n${error.stack}` : ""}
            {componentStack ? `\n\nComponent stack:${componentStack}` : ""}
          </pre>
        </details>
      </div>
    );
  }
}
