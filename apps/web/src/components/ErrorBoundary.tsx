import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main>
          <div className="banner error" role="alert">
            <h1>Workspace could not load</h1>
            <p>
              Reload to restore the browser UI. This does not confirm or change
              the host task outcome.
            </p>
            <a className="button" href={window.location.href}>
              Reload workspace
            </a>
          </div>
        </main>
      );
    return this.props.children;
  }
}
