import React from "react";

type State = {
  error: Error | null;
};

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("FSTDESK client render failed", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="gb-shell">
        <div className="gb-tabline">
          <div className="gb-tabline-left">
            <div className="gb-tab active" style={{ paddingLeft: 12 }}>
              <a href="/" style={{ color: "var(--gb-yellow)", fontWeight: 700, textDecoration: "none" }}>FSTDESK</a>
            </div>
          </div>
          <div className="gb-tabline-right">utf-8 | unix</div>
        </div>
        <div className="gb-main" style={{ overflow: "auto" }}>
          <div className="gb-content">
            <table className="gb-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "right", paddingRight: 16 }}>#</th>
                  <th>STATUS</th>
                  <th>DETAIL</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ color: "var(--gb-red)", textAlign: "right", paddingRight: 16 }}>!</td>
                  <td style={{ color: "var(--gb-red)", fontWeight: 700 }}>error: client failed</td>
                  <td style={{ color: "var(--gb-fg4)" }}>{this.state.error.message || "render error"}</td>
                </tr>
                <tr>
                  <td style={{ color: "var(--gb-bg3)", textAlign: "right", paddingRight: 16 }}>~</td>
                  <td colSpan={2}>
                    <a href="/" style={{ color: "var(--gb-yellow)", fontWeight: 700 }}>$ reload home</a>
                    <span style={{ color: "var(--gb-gray)" }}> / </span>
                    <a href="/?fresh=1" style={{ color: "var(--gb-green)", fontWeight: 700 }}>$ fresh reload</a>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div className="gb-statusbar">
          <span className="gb-statusbar-mode">ERROR &nbsp; client</span>
          <span style={{ flex: 1 }} />
          <span className="gb-statusbar-right">fallback &nbsp; 100%</span>
        </div>
      </div>
    );
  }
}
