// Synthetic, fixed lexical regression corpus. Not a representative user dataset.
export const benchmarkMemories = [
  {
    id: "korean-format",
    title: "보고서 작성 기준",
    content:
      "업무 보고서는 한국어로 작성한다. 결론, 근거 링크, 다음 행동과 담당자를 기록한다.",
  },
  {
    id: "quota",
    title: "Model request failures",
    content:
      "ERR_QUOTA_EXCEEDED means the quota is exhausted. Do not retry publishing when the result is uncertain.",
  },
  {
    id: "owner",
    title: "Review responsibility",
    content:
      "The approval owner for the release checklist is Mina. Ask Mina to review the artifact.",
  },
  {
    id: "backup",
    title: "Volume recovery",
    content:
      "The SQLite backup location is /data/backups. Keep the database and its WAL together during recovery.",
  },
  {
    id: "unicode",
    title: "문자 정규화",
    content:
      "한글 메모는 정규화한 문자열로 검색한다. 고객상담기록에서 반품 절차를 찾을 수 있어야 한다.",
  },
  {
    id: "handoff",
    title: "Task checkpoint",
    content:
      "Before switching tasks, save the current decision, unfinished work and next action as an episodic checkpoint.",
  },
  {
    id: "privacy",
    title: "Private credentials",
    content:
      "Access tokens and passwords stay outside persistent work memory. Do not place credentials into notes.",
  },
  {
    id: "long-tail",
    title: "Operations notebook",
    content:
      "일반 운영 기록: 화면 확인과 문서 정리를 수행했다.\n".repeat(120) +
      "\nTAIL-RECOVERY-47: restore the blue archive before restarting the worker.",
  },
  {
    id: "plan",
    title: "Search budget",
    content:
      "원격 임베딩 API는 사용하지 않는다. 별도의 모델 과금 없이 로컬 키워드 검색을 사용한다.",
  },
  {
    id: "port",
    title: "Server bindings",
    content:
      "Dingdong listens on 5490. The private OpenClaw tool host listens on loopback port 18797.",
  },
  ...Array.from({ length: 6 }, (_, i) => ({
    id: `deployment-${i}`,
    title: `Deployment memo ${i}`,
    content:
      "Deploy checklist: build, review, health check and rollout. The deployment checklist is reviewed before rollout.",
  })),
  ...Array.from({ length: 16 }, (_, i) => ({
    id: `unrelated-${i}`,
    title: `Synthetic inventory ${i}`,
    content: `Warehouse inventory batch ${i}: boxes, labels, delivery bins and packaging material.`,
  })),
];
export const benchmarkQueries = [
  { query: "보고서 한국어", relevant: ["korean-format"], evidence: "담당자" },
  {
    query: "한국어".normalize("NFD"),
    relevant: ["korean-format"],
    evidence: "한국어",
  },
  { query: "ERR/QUOTA/EXCEEDED", relevant: ["quota"], evidence: "exhausted" },
  { query: "approval owner Mina", relevant: ["owner"], evidence: "Mina" },
  { query: "SQLite backup", relevant: ["backup"], evidence: "/data/backups" },
  { query: "상담기록", relevant: ["unicode"], evidence: "반품" },
  {
    query: "episodic checkpoint",
    relevant: ["handoff"],
    evidence: "unfinished",
  },
  {
    query: "credentials passwords",
    relevant: ["privacy"],
    evidence: "outside",
  },
  {
    query: "TAIL-RECOVERY-47",
    relevant: ["long-tail"],
    evidence: "blue archive",
  },
  { query: "18797", relevant: ["port"], evidence: "loopback" },
  // Paraphrase challenges; some wording still overlaps indexed keywords.
  {
    query: "Who signs off on shipping?",
    relevant: ["owner"],
    evidence: "Mina",
  },
  {
    query: "벡터 검색 때문에 지출이 늘어나도 되나",
    relevant: ["plan"],
    evidence: "사용하지 않는다",
  },
];
