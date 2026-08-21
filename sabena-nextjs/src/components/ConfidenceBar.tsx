export default function ConfidenceBar({
  value,
  size = "md",
}: {
  value: number; // 0-100
  size?: "sm" | "md";
}) {
  const pct = Math.max(0, Math.min(100, value));
  const color =
    pct >= 80 ? "from-violet-500 to-violet-400" : pct >= 60 ? "from-amber-400 to-amber-300" : "from-rose-500 to-rose-400";
  const height = size === "sm" ? "h-1.5" : "h-2";
  return (
    <div className={`w-full rounded-full bg-violet-100 ${height} overflow-hidden`}>
      <div
        className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-700 ease-out`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
