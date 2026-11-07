/**
 * 초기 데이터 SQL 생성기
 *  - 구분(KPI · 일반 · 출장 및 휴가), 회의구분(주간 · 월간 · 임시), 부서 4개
 *  - 첫 시스템 관리자 계정 (임시 비밀번호, 첫 로그인 시 변경 강제)
 *
 * 실행: npm run db:seed:local | npm run db:seed:remote
 * 결과: scripts/seed.sql, scripts/seed-credentials.txt (둘 다 git 제외)
 * INSERT OR IGNORE 이므로 여러 번 실행해도 기존 데이터는 바뀌지 않는다.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const CRED_FILE = join(here, "seed-credentials.txt");

const ADMIN = {
  empNo: "S000001",
  loginId: "songys",
  name: "송영심",
  position: "팀장",
  deptCode: "T01",
  role: "leader",
};

const DEPARTMENTS = [
  ["T01", "경영지원팀", 1],
  ["T02", "사업개발(덴탈)", 2],
  ["T03", "사업개발(미용)", 3],
  ["T04", "구매(덴탈)", 4],
  ["T05", "구매(미용)", 5],
  ["T06", "생산팀", 6],
  ["T07", "품질경영팀", 7],
  ["T08", "연구소", 8],
  ["T09", "RA팀", 9],
];

function tempPassword(length = 12) {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnpqrstuvwxyz", "23456789", "!@#$%^&*"];
  const all = sets.join("");
  const rand = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  const chars = sets.map((s) => s[rand(s.length)]);
  while (chars.length < length) chars.push(all[rand(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// worker/lib/crypto.ts 와 동일한 형식: pbkdf2$<iter>$<saltB64>$<hashB64>
async function hashPassword(password) {
  const iterations = 100_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  const b64 = (u8) => Buffer.from(u8).toString("base64");
  return `pbkdf2$${iterations}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

const q = (v) => (v === null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);

// 로컬 · 원격에 같은 임시 비밀번호를 쓰도록 기존 값 재사용
let password;
if (existsSync(CRED_FILE)) {
  const m = readFileSync(CRED_FILE, "utf8").match(/임시 비밀번호:\s*(\S+)/);
  password = m?.[1];
}
password ??= tempPassword();
const passwordHash = await hashPassword(password);

const sql = [
  "-- 자동 생성 파일 (scripts/make-seed.mjs). 직접 수정하지 마세요.",
  "INSERT OR IGNORE INTO report_categories (code, name, sort_order, is_system) VALUES",
  "  ('KPI', 'KPI', 1, 0), ('GENERAL', '일반', 2, 0), ('TRAVEL', '출장 및 휴가', 3, 1);",
  "INSERT OR IGNORE INTO codes (group_code, code, name, sort_order) VALUES",
  "  ('MEETING_TYPE', 'WEEKLY', '주간', 1), ('MEETING_TYPE', 'MONTHLY', '월간', 2), ('MEETING_TYPE', 'ADHOC', '임시', 3);",
  "INSERT OR IGNORE INTO departments (code, name, sort_order) VALUES",
  DEPARTMENTS.map(([c, n, s]) => `  (${q(c)}, ${q(n)}, ${s})`).join(",\n") + ";",
  `INSERT OR IGNORE INTO employees (emp_no, login_id, name, department_id, position, role, is_clerk, is_admin, status, password_hash, must_change_password)
  SELECT ${q(ADMIN.empNo)}, ${q(ADMIN.loginId)}, ${q(ADMIN.name)}, id, ${q(ADMIN.position)}, ${q(ADMIN.role)}, 1, 1, 'pending', ${q(passwordHash)}, 1
  FROM departments WHERE code = ${q(ADMIN.deptCode)};`,
  `UPDATE departments SET leader_id = (SELECT id FROM employees WHERE login_id = ${q(ADMIN.loginId)})
  WHERE code = ${q(ADMIN.deptCode)} AND leader_id IS NULL;`,
  "",
].join("\n");

writeFileSync(join(here, "seed.sql"), sql, "utf8");
writeFileSync(
  CRED_FILE,
  [
    "업무트래커 초기 관리자 계정 (git 제외 파일, 공유 후 삭제 권장)",
    `아이디: ${ADMIN.loginId}`,
    `임시 비밀번호: ${password}`,
    "첫 로그인 시 새 비밀번호 설정 화면으로 이동합니다.",
    "※ 이미 계정이 있는 DB에는 적용되지 않습니다 (INSERT OR IGNORE).",
    "",
  ].join("\n"),
  "utf8",
);
console.log("seed.sql 생성 완료 · 관리자 계정 정보: scripts/seed-credentials.txt");
