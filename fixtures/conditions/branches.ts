declare function error(): void;
declare function update(): void;
declare const blocked: boolean;
export function saveOrder() {
  if (blocked) { error(); return; }
  update();
}
