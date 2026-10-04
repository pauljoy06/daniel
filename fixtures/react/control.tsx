import { helper } from '../helper.js';

interface ControlContext {
  parameters: { title: { raw: string | null } };
  mode: { isControlDisabled: boolean };
  notifyOutputChanged(): void;
}

/** Representative PCF/React-style fixture, not a real application certification. */
export function renderControl(context: ControlContext) {
  const title = context.parameters.title.raw ?? 'Untitled';
  if (context.mode.isControlDisabled) {
    return <span>{title}</span>;
  }
  helper();
  const onClick = () => context.notifyOutputChanged();
  return <button onClick={onClick}>{formatTitle(title)}</button>;
}

function formatTitle(title: string) {
  return title.trim();
}
