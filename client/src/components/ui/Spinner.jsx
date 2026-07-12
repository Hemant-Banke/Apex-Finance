/**
 * The loading spinner, centred in a box of its own.
 *
 * `height` is what varies between call sites — a page blanks to 60vh, a panel to a
 * couple of hundred pixels — so it is the only knob.
 */
export default function Spinner({ height = '60vh' }) {
  return (
    <div className="flex items-center justify-center" style={{ height }}>
      <div className="spinner" />
    </div>
  );
}
