export function fixed(
  length: number,
  code: string,
  fields: Record<number, string>,
) {
  const chars = Array.from(code.padEnd(length));
  for (const [start, value] of Object.entries(fields))
    chars.splice(+start, value.length, ...value);
  return chars.join("");
}
export function hy3(code: string, fields: Record<number, string>) {
  const line = fixed(128, code, fields);
  let sum = 0;
  for (let i = 0; i < 128; i++) sum += line.charCodeAt(i) * (i % 2 ? 2 : 1);
  const checksum = Math.floor(sum / 21) + 205;
  return line + `${checksum % 10}${Math.floor(checksum / 10) % 10}`;
}
export const bytes = (lines: string[]) =>
  new TextEncoder().encode(lines.join("\r\n") + "\r\n");
export function individual(format = "sd3", status = "1:05.00") {
  return {
    name: `synthetic.${format}`,
    bytes: bytes([
      fixed(160, "A0", {}),
      fixed(160, "B1", {
        11: "Synthetic Meet",
        121: "11012026",
        129: "11012026",
      }),
      fixed(160, "C1", { 11: "IEVS", 17: "Velocity Swimming" }),
      fixed(160, "D0", {
        11: "Swimmer, Synthetic",
        39: "TEST00000001",
        55: "01022010",
        63: "16",
        65: "F",
        67: " 100",
        71: "1",
        72: "   5",
        76: "1316",
        80: "11012026",
        115: status.padStart(8),
        123: "Y",
      }),
      fixed(160, "D3", { 2: "TEST0000000101" }),
      fixed(160, "Z0", {}),
    ]),
  };
}
export function hyIndividual(invalidFollowingEntry = false) {
  const lines = [
    hy3("A107", {}),
    hy3("B1", { 2: "Synthetic Meet", 92: "11012026", 100: "11012026" }),
    hy3("C1", { 2: "VS", 7: "Velocity Swimming", 53: "IE" }),
    hy3("D1", {
      2: "F",
      3: "    1",
      8: "Swimmer",
      28: "Synthetic",
      69: "TEST0000000101",
      88: "01022010",
    }),
    hy3("E1", { 3: "    1", 15: "   100", 21: "A", 38: "   5" }),
    hy3("E2", { 2: "F", 4: "  65.00", 11: "Y", 87: "11012026" }),
  ];
  if (invalidFollowingEntry)
    lines.push(
      hy3("E1", { 3: "    2", 15: "   200", 21: "A", 38: "   6" }),
      hy3("E2", { 2: "F", 4: " 120.00", 11: "Y", 87: "11012026" }),
    );
  return { name: "individual.hy3", bytes: bytes(lines) };
}
export function relayPair(missing = -1) {
  const h = [
    hy3("A107", {}),
    hy3("B1", { 2: "Synthetic Meet", 92: "11012026", 100: "11012026" }),
    hy3("C1", { 2: "VS", 7: "Velocity Swimming", 53: "IE" }),
  ];
  for (let leg = 1; leg <= 4; leg++)
    h.push(
      hy3("D1", {
        2: leg % 2 ? "F" : "M",
        3: String(leg).padStart(5),
        8: `Last${leg}`,
        28: `First${leg}`,
        69: `MEMBER00000${leg}`,
        88: "01012010",
      }),
    );
  h.push(
    hy3("F1", {
      2: "VS",
      7: "A",
      12: "X",
      15: "   200",
      21: "E",
      22: "  0",
      25: " 12",
      38: "  8B",
    }),
    hy3("F2", { 2: "F", 4: " 120.00", 11: "Y", 102: "11012026" }),
    hy3(
      "G1",
      Object.fromEntries(
        [0, 1, 2, 3].map((i) => [
          2 + i * 11,
          `F${String(i + 1).padStart(2)}${(i === missing ? "0:00.00" : `${(i + 1) * 30}.00`).padStart(8)}`,
        ]),
      ),
    ),
    hy3(
      "F3",
      Object.fromEntries(
        [0, 1, 2, 3].map((i) => [
          2 + i * 13,
          `${(i + 1) % 2 ? "F" : "M"}${String(i + 1).padStart(5)}Last${i + 1}F${i + 1}`,
        ]),
      ),
    ),
  );
  const c = [
    fixed(160, "A0", {}),
    fixed(160, "B1", {
      11: "Synthetic Meet",
      121: "11012026",
      129: "11012026",
    }),
    fixed(160, "C1", { 11: "IEVS", 17: "Velocity Swimming" }),
    fixed(160, "E0", {
      11: "A",
      12: "IEVS",
      20: "X",
      21: " 200",
      25: "7",
      26: "  8B",
      30: "UN12",
      37: "11012026",
      72: " 2:00.00Y",
    }),
  ];
  for (let i = 0; i < 4; i++) {
    c.push(
      fixed(160, "F0", {
        15: "IEVS",
        21: "A",
        22: `Last${i + 1}, First${i + 1}`,
        50: `MEMBER00000${i + 1}`,
        65: "01012010",
        75: (i + 1) % 2 ? "F" : "M",
        78: String(i + 1),
      }),
    );
    c.push(
      fixed(160, "G0", {
        43: `MEMBER00000${i + 1}`,
        55: "1",
        56: " 4",
        58: "  50",
        62: "C",
        63: i === missing ? "" : `${(i + 1) * 30}.00`.padStart(8),
        143: "F",
      }),
    );
  }
  c.push(fixed(160, "Z0", {}));
  return [
    { name: "synthetic.hy3", bytes: bytes(h) },
    { name: "synthetic.cl2", bytes: bytes(c) },
  ];
}
