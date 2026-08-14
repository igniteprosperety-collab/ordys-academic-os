export type SubjectKey = "mat" | "his" | "bio" | "fis" | "qui" | "lit";

export const subjects: {
  key: SubjectKey;
  name: string;
  short: string;
  teacher: string;
  room: string;
  average: number;
  attendance: number;
  nextClass: string;
  color: string;
}[] = [
  {
    key: "mat",
    name: "Matemática",
    short: "MAT",
    teacher: "Prof. Helena Prado",
    room: "Sala 204",
    average: 8.7,
    attendance: 94,
    nextClass: "10:30",
    color: "var(--chart-1)",
  },
  {
    key: "his",
    name: "História",
    short: "HIS",
    teacher: "Prof. Rui Andrade",
    room: "Sala 112",
    average: 9.1,
    attendance: 94,
    nextClass: "13:00",
    color: "var(--chart-4)",
  },
  {
    key: "bio",
    name: "Biologia",
    short: "BIO",
    teacher: "Prof. Clara Meireles",
    room: "Lab. 2",
    average: 7.9,
    attendance: 91,
    nextClass: "Amanhã, 08:00",
    color: "var(--chart-2)",
  },
  {
    key: "fis",
    name: "Física",
    short: "FIS",
    teacher: "Prof. Daniel Kaufman",
    room: "Sala 301",
    average: 8.4,
    attendance: 82,
    nextClass: "Amanhã, 10:30",
    color: "var(--chart-5)",
  },
  {
    key: "qui",
    name: "Química",
    short: "QUI",
    teacher: "Prof. Ana Sartori",
    room: "Lab. 1",
    average: 8.2,
    attendance: 96,
    nextClass: "Quarta, 09:15",
    color: "var(--chart-3)",
  },
  {
    key: "lit",
    name: "Literatura",
    short: "LIT",
    teacher: "Prof. Marcos Vilela",
    room: "Sala 108",
    average: 8.9,
    attendance: 98,
    nextClass: "Quinta, 11:00",
    color: "var(--gold)",
  },
];

export const subjectByKey = (key: SubjectKey) =>
  subjects.find((s) => s.key === key) ?? subjects[0];

export type ClassBlock = {
  start: string;
  end: string;
  subject: SubjectKey;
  label: string;
  room: string;
  kind: "aula" | "prova" | "estudo" | "evento";
};

export const today: ClassBlock[] = [
  { start: "08:00", end: "08:50", subject: "lit", label: "Literatura", room: "Sala 108", kind: "aula" },
  { start: "09:00", end: "09:50", subject: "qui", label: "Química", room: "Lab. 1", kind: "aula" },
  { start: "10:30", end: "11:20", subject: "mat", label: "Matemática", room: "Sala 204", kind: "aula" },
  { start: "11:30", end: "12:20", subject: "bio", label: "Biologia", room: "Lab. 2", kind: "aula" },
  { start: "13:00", end: "13:50", subject: "his", label: "História", room: "Sala 112", kind: "aula" },
  { start: "15:00", end: "16:00", subject: "mat", label: "Sessão de foco · Lista de exercícios", room: "Estudo", kind: "estudo" },
  { start: "19:00", end: "20:00", subject: "fis", label: "Revisão · Cinemática", room: "Estudo", kind: "estudo" },
];

export const weekDays = [
  { label: "Seg", date: "10", load: 5, exams: 0, active: false },
  { label: "Ter", date: "11", load: 6, exams: 0, active: true },
  { label: "Qua", date: "12", load: 4, exams: 1, active: false },
  { label: "Qui", date: "13", load: 5, exams: 0, active: false },
  { label: "Sex", date: "14", load: 3, exams: 1, active: false },
  { label: "Sáb", date: "15", load: 1, exams: 0, active: false },
  { label: "Dom", date: "16", load: 2, exams: 0, active: false },
];

export type Task = {
  id: string;
  title: string;
  subject: SubjectKey;
  due: string;
  priority: "alta" | "média" | "baixa";
  status: "nao_iniciada" | "em_andamento" | "concluida" | "atrasada";
  subtasks: [number, number];
  bucket: "hoje" | "semana" | "proximas" | "atrasadas" | "concluidas";
};

export const tasks: Task[] = [
  { id: "t1", title: "Lista de exercícios — funções quadráticas", subject: "mat", due: "Hoje, 22:00", priority: "alta", status: "em_andamento", subtasks: [3, 5], bucket: "hoje" },
  { id: "t2", title: "Trabalho de História — Revolução Industrial", subject: "his", due: "Amanhã, 23:59", priority: "alta", status: "em_andamento", subtasks: [2, 6], bucket: "semana" },
  { id: "t3", title: "Relatório de laboratório — osmose", subject: "bio", due: "Seg, 08:00", priority: "média", status: "nao_iniciada", subtasks: [0, 4], bucket: "proximas" },
  { id: "t4", title: "Resumo de cinemática", subject: "fis", due: "Venceu ontem", priority: "alta", status: "atrasada", subtasks: [1, 3], bucket: "atrasadas" },
  { id: "t5", title: "Ficha de leitura — Machado de Assis", subject: "lit", due: "Venceu há 3 dias", priority: "média", status: "atrasada", subtasks: [0, 2], bucket: "atrasadas" },
  { id: "t6", title: "Exercícios de estequiometria", subject: "qui", due: "Qui, 18:00", priority: "baixa", status: "nao_iniciada", subtasks: [0, 3], bucket: "proximas" },
  { id: "t7", title: "Mapa mental — Genética", subject: "bio", due: "Entregue seg", priority: "média", status: "concluida", subtasks: [4, 4], bucket: "concluidas" },
  { id: "t8", title: "Simulado de linguagens", subject: "lit", due: "Entregue sex", priority: "baixa", status: "concluida", subtasks: [2, 2], bucket: "concluidas" },
];

export type Exam = {
  id: string;
  subject: SubjectKey;
  title: string;
  date: string;
  inDays: number;
  weight: string;
  content: string;
  grade?: number;
};

export const exams: Exam[] = [
  { id: "e1", subject: "mat", title: "Prova bimestral", date: "Sex, 14 nov · 10:30", inDays: 3, weight: "Peso 3", content: "Funções, logaritmos, progressões" },
  { id: "e2", subject: "qui", title: "Avaliação de laboratório", date: "Qua, 19 nov · 09:15", inDays: 8, weight: "Peso 2", content: "Estequiometria e soluções" },
  { id: "e3", subject: "his", title: "Trabalho em grupo", date: "Seg, 24 nov", inDays: 13, weight: "Peso 2", content: "Revolução Industrial" },
  { id: "e4", subject: "fis", title: "Simulado geral", date: "Sáb, 29 nov", inDays: 18, weight: "Simulado", content: "Cinemática e dinâmica" },
];

export const pastExams: Exam[] = [
  { id: "p1", subject: "his", title: "Prova 1º bimestre", date: "12 set", inDays: -60, weight: "Peso 3", content: "Idade Moderna", grade: 9.4 },
  { id: "p2", subject: "mat", title: "Prova 1º bimestre", date: "10 set", inDays: -62, weight: "Peso 3", content: "Trigonometria", grade: 8.5 },
  { id: "p3", subject: "bio", title: "Avaliação de citologia", date: "28 ago", inDays: -75, weight: "Peso 2", content: "Citologia", grade: 7.6 },
];

export const attentionItems = [
  { tone: "warning" as const, text: "Trabalho de História vence amanhã.", meta: "2 de 6 subtarefas concluídas" },
  { tone: "primary" as const, text: "Você tem prova de Matemática em 3 dias.", meta: "Funções, logaritmos e progressões" },
  { tone: "destructive" as const, text: "2 tarefas estão atrasadas.", meta: "Física e Literatura" },
  { tone: "gold" as const, text: "Sua frequência em Física caiu para 82%.", meta: "Limite crítico: 75%" },
];

export const notifications = [
  { text: "Aula de Matemática começa em 20 minutos.", time: "agora" },
  { text: "Prova de Matemática em 3 dias.", time: "1h" },
  { text: "Tarefa de História vence amanhã.", time: "3h" },
  { text: "Seu desempenho em Física caiu 0,4 ponto.", time: "ontem" },
];

export const studyPlan = [
  { subject: "mat" as SubjectKey, target: "2h esta semana", done: 78 },
  { subject: "bio" as SubjectKey, target: "1h30 esta semana", done: 54 },
  { subject: "his" as SubjectKey, target: "45min esta semana", done: 92 },
  { subject: "fis" as SubjectKey, target: "2h esta semana", done: 31 },
];

export const goals = [
  { title: "Atingir média 9,0 em Matemática", progress: 84, detail: "Média atual 8,7 · faltam 0,3" },
  { title: "Estudar 8 horas esta semana", progress: 61, detail: "4h54 de 8h" },
  { title: "Entregar todas as tarefas no prazo", progress: 72, detail: "13 de 18 no prazo" },
  { title: "Manter frequência acima de 90%", progress: 93, detail: "Média geral 92,5%" },
];

export const evolution = [
  { period: "Mar", grade: 7.4, hours: 5 },
  { period: "Abr", grade: 7.8, hours: 6 },
  { period: "Mai", grade: 8.0, hours: 7 },
  { period: "Jun", grade: 7.9, hours: 5 },
  { period: "Ago", grade: 8.3, hours: 8 },
  { period: "Set", grade: 8.5, hours: 9 },
  { period: "Out", grade: 8.6, hours: 10 },
  { period: "Nov", grade: 8.8, hours: 11 },
];

export const materials = [
  { name: "Funções quadráticas — apostila", subject: "mat" as SubjectKey, type: "PDF", size: "2,4 MB" },
  { name: "Revolução Industrial — slides da aula", subject: "his" as SubjectKey, type: "Slides", size: "8,1 MB" },
  { name: "Roteiro de laboratório — osmose", subject: "bio" as SubjectKey, type: "Documento", size: "310 KB" },
  { name: "Cinemática — videoaula", subject: "fis" as SubjectKey, type: "Link", size: "youtube.com" },
  { name: "Tabela periódica anotada", subject: "qui" as SubjectKey, type: "Imagem", size: "1,1 MB" },
];

export const notes = [
  { title: "Fórmulas de Bhaskara e vértice", subject: "mat" as SubjectKey, when: "hoje", linked: "Aula de 10:30" },
  { title: "Causas da Revolução Industrial", subject: "his" as SubjectKey, when: "ontem", linked: "Trabalho de História" },
  { title: "Dúvidas para o professor de Física", subject: "fis" as SubjectKey, when: "2 dias", linked: "Prova · Cinemática" },
  { title: "Checklist do relatório de Biologia", subject: "bio" as SubjectKey, when: "3 dias", linked: "Tarefa" },
];
