type DemoRow = Record<string, unknown>;
export type OrdysDemoDataset = Record<string, DemoRow[]>;

const uid = () => {
  try {
    return crypto.randomUUID();
  } catch {
    return `demo-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
};

function dateAfter(reference: Date, days: number) {
  const date = new Date(reference);
  date.setDate(date.getDate() + days);
  return date;
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateTime(reference: Date, days: number, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  const date = dateAfter(reference, days);
  date.setHours(hour ?? 9, minute ?? 0, 0, 0);
  return date.toISOString();
}

function weekday(date: Date) {
  return (date.getDay() + 6) % 7;
}

function timeString(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:00`;
}

/**
 * Synthetic student data for a guided, local-only demonstration.
 * Every row is owned by the supplied local profile; no cloud request is made.
 */
export function createOrdysDemoDataset(
  userId: string,
  profileName: string,
  now = new Date(),
): OrdysDemoDataset {
  const createdAt = dateTime(now, -14, "09:00");
  const updatedAt = now.toISOString();

  const subjects = [
    {
      id: uid(),
      name: "Matemática",
      short_name: "MAT",
      color: "#6685FF",
      teacher: "Prof.ª Camila Nunes",
      room: "Sala 12",
      weekly_hours: 4,
      grade_goal: 7,
      attendance_goal: 75,
    },
    {
      id: uid(),
      name: "Língua Portuguesa",
      short_name: "PORT",
      color: "#39A8A4",
      teacher: "Prof. Rafael Costa",
      room: "Sala 08",
      weekly_hours: 4,
      grade_goal: 7,
      attendance_goal: 75,
    },
    {
      id: uid(),
      name: "Biologia",
      short_name: "BIO",
      color: "#E5A64B",
      teacher: "Prof.ª Júlia Martins",
      room: "Laboratório 2",
      weekly_hours: 3,
      grade_goal: 7,
      attendance_goal: 75,
    },
    {
      id: uid(),
      name: "História",
      short_name: "HIST",
      color: "#A58BE3",
      teacher: "Prof. André Lima",
      room: "Sala 15",
      weekly_hours: 2,
      grade_goal: 7,
      attendance_goal: 75,
    },
  ].map((subject) => ({
    ...subject,
    user_id: userId,
    archived: false,
    term: "2026 · 2º semestre",
    created_at: createdAt,
    updated_at: updatedAt,
  }));

  const [math, portuguese, biology, history] = subjects;
  if (!math || !portuguese || !biology || !history) {
    throw new Error("Não foi possível montar as disciplinas de demonstração.");
  }

  const topics = [
    {
      id: uid(),
      subject_id: math.id,
      title: "Equações do 1º grau",
      status: "dominado",
      mastery: 86,
      position: 0,
      notes: "Revisar os exercícios de fixação.",
    },
    {
      id: uid(),
      subject_id: math.id,
      title: "Funções do 1º grau",
      status: "estudando",
      mastery: 58,
      position: 1,
      notes: "Praticar leitura de gráficos.",
    },
    {
      id: uid(),
      subject_id: math.id,
      title: "Razão e proporção",
      status: "precisa_revisar",
      mastery: 42,
      position: 2,
      notes: "Retomar regra de três.",
    },
    {
      id: uid(),
      subject_id: portuguese.id,
      title: "Interpretação de texto",
      status: "estudado",
      mastery: 78,
      position: 0,
      notes: null,
    },
    {
      id: uid(),
      subject_id: portuguese.id,
      title: "Funções da linguagem",
      status: "estudando",
      mastery: 64,
      position: 1,
      notes: "Relacionar função e intenção comunicativa.",
    },
    {
      id: uid(),
      subject_id: portuguese.id,
      title: "Classes gramaticais",
      status: "dominado",
      mastery: 91,
      position: 2,
      notes: null,
    },
    {
      id: uid(),
      subject_id: biology.id,
      title: "Células e organelas",
      status: "dominado",
      mastery: 88,
      position: 0,
      notes: null,
    },
    {
      id: uid(),
      subject_id: biology.id,
      title: "Genética mendeliana",
      status: "precisa_revisar",
      mastery: 49,
      position: 1,
      notes: "Rever primeira e segunda leis de Mendel.",
    },
    {
      id: uid(),
      subject_id: history.id,
      title: "Brasil República",
      status: "estudado",
      mastery: 74,
      position: 0,
      notes: null,
    },
    {
      id: uid(),
      subject_id: history.id,
      title: "Era Vargas",
      status: "estudando",
      mastery: 61,
      position: 1,
      notes: "Organizar uma linha do tempo.",
    },
  ].map((topic) => ({
    ...topic,
    user_id: userId,
    last_review: dateKey(dateAfter(now, -4)),
    next_review: dateKey(dateAfter(now, topic.mastery < 55 ? 1 : 4)),
    created_at: createdAt,
    updated_at: updatedAt,
  }));

  const topic = (title: string) => topics.find((row) => row.title === title);
  const mathFunctions = topic("Funções do 1º grau");
  const mathRatio = topic("Razão e proporção");
  const portugueseLanguage = topic("Funções da linguagem");
  const biologyGenetics = topic("Genética mendeliana");
  const historyVargas = topic("Era Vargas");
  if (
    !mathFunctions ||
    !mathRatio ||
    !portugueseLanguage ||
    !biologyGenetics ||
    !historyVargas
  ) {
    throw new Error(
      "Não foi possível relacionar os conteúdos de demonstração.",
    );
  }

  const tasks = [
    {
      id: uid(),
      title: "Lista de exercícios — funções",
      description:
        "Resolver os exercícios 1 a 12 e registrar as dúvidas para a próxima aula.",
      subject_id: math.id,
      topic_id: mathFunctions.id,
      due_at: dateTime(now, -1, "18:00"),
      estimated_minutes: 45,
      priority: "alta",
      status: "em_andamento",
      completed_at: null,
    },
    {
      id: uid(),
      title: "Resumo: funções da linguagem",
      description: "Montar um resumo com exemplos de cada função da linguagem.",
      subject_id: portuguese.id,
      topic_id: portugueseLanguage.id,
      due_at: dateTime(now, 2, "20:00"),
      estimated_minutes: 35,
      priority: "media",
      status: "pendente",
      completed_at: null,
    },
    {
      id: uid(),
      title: "Revisar genética mendeliana",
      description:
        "Revisar os cruzamentos e resolver cinco questões de fixação.",
      subject_id: biology.id,
      topic_id: biologyGenetics.id,
      due_at: dateTime(now, 3, "19:00"),
      estimated_minutes: 40,
      priority: "alta",
      status: "pendente",
      completed_at: null,
    },
    {
      id: uid(),
      title: "Análise de texto — atividade 2",
      description: "Atividade concluída para compor o histórico acadêmico.",
      subject_id: portuguese.id,
      topic_id: topic("Interpretação de texto")?.id ?? null,
      due_at: dateTime(now, -5, "17:00"),
      estimated_minutes: 30,
      priority: "baixa",
      status: "concluida",
      completed_at: dateTime(now, -4, "16:20"),
    },
    {
      id: uid(),
      title: "Linha do tempo: Era Vargas",
      description:
        "Organizar os principais acontecimentos em ordem cronológica.",
      subject_id: history.id,
      topic_id: historyVargas.id,
      due_at: dateTime(now, 5, "18:00"),
      estimated_minutes: 50,
      priority: "media",
      status: "pendente",
      completed_at: null,
    },
  ].map((task) => ({
    ...task,
    user_id: userId,
    created_at: createdAt,
    updated_at: updatedAt,
  }));

  const lateTask = tasks.find(
    (row) => row.title === "Lista de exercícios — funções",
  );
  const upcomingTask = tasks.find(
    (row) => row.title === "Resumo: funções da linguagem",
  );

  const subtasks = [
    {
      id: uid(),
      task_id: lateTask?.id,
      title: "Resolver questões 1 a 6",
      done: true,
    },
    {
      id: uid(),
      task_id: lateTask?.id,
      title: "Resolver questões 7 a 12",
      done: false,
    },
    {
      id: uid(),
      task_id: upcomingTask?.id,
      title: "Identificar as seis funções",
      done: false,
    },
    {
      id: uid(),
      task_id: upcomingTask?.id,
      title: "Adicionar um exemplo de cada",
      done: false,
    },
  ].map((row) => ({ ...row, user_id: userId, created_at: createdAt }));

  const exams = [
    {
      id: uid(),
      title: "Avaliação de Matemática",
      kind: "prova",
      subject_id: math.id,
      exam_at: dateTime(now, 4, "09:30"),
      content: "Funções do 1º grau, gráficos e razão e proporção.",
      weight: "2",
    },
    {
      id: uid(),
      title: "Simulado de Ciências Humanas",
      kind: "simulado",
      subject_id: history.id,
      exam_at: dateTime(now, 8, "10:00"),
      content: "Brasil República e Era Vargas.",
      weight: "1",
    },
  ].map((exam) => ({
    ...exam,
    user_id: userId,
    created_at: createdAt,
    updated_at: updatedAt,
  }));

  const grades = [
    {
      id: uid(),
      subject_id: math.id,
      title: "Avaliação 1",
      score: 7.8,
      max_score: 10,
      weight: 2,
      term: "2º semestre",
      graded_on: dateKey(dateAfter(now, -9)),
    },
    {
      id: uid(),
      subject_id: portuguese.id,
      title: "Interpretação textual",
      score: 8.6,
      max_score: 10,
      weight: 1,
      term: "2º semestre",
      graded_on: dateKey(dateAfter(now, -7)),
    },
    {
      id: uid(),
      subject_id: biology.id,
      title: "Atividade de laboratório",
      score: 9.2,
      max_score: 10,
      weight: 1,
      term: "2º semestre",
      graded_on: dateKey(dateAfter(now, -3)),
    },
  ].map((grade) => ({
    ...grade,
    user_id: userId,
    exam_id: null,
    created_at: createdAt,
  }));

  const attendance = subjects.flatMap((subject, subjectIndex) =>
    [-21, -14, -7].map((days, index) => ({
      id: uid(),
      user_id: userId,
      subject_id: subject.id,
      class_date: dateKey(dateAfter(now, days)),
      status:
        (subjectIndex === 2 && index === 1) ||
        (subjectIndex === 3 && index === 0)
          ? "falta"
          : "presente",
      note: null,
      created_at: createdAt,
    })),
  );

  const currentClassDate = new Date(now);
  if (currentClassDate.getHours() >= 21) {
    currentClassDate.setDate(currentClassDate.getDate() + 1);
    currentClassDate.setHours(8, 0, 0, 0);
  } else {
    currentClassDate.setHours(currentClassDate.getHours() + 1, 0, 0, 0);
  }
  const scheduleOffsets = [0, 1, 2, 3];
  const schedules = subjects.map((subject, index) => {
    const scheduledDate = dateAfter(
      currentClassDate,
      scheduleOffsets[index] ?? index,
    );
    const scheduledWeekday = weekday(scheduledDate);
    const hour = index === 0 ? currentClassDate.getHours() : 8 + index;
    const start = `${String(hour).padStart(2, "0")}:00:00`;
    const end = `${String(Math.min(hour + 1, 23)).padStart(2, "0")}:00:00`;
    return {
      id: uid(),
      user_id: userId,
      subject_id: subject.id,
      weekday: scheduledWeekday,
      start_time: start,
      end_time: end,
      room: subject.room,
      created_at: createdAt,
    };
  });

  const studyStart = new Date(now);
  if (studyStart.getHours() >= 21) {
    studyStart.setDate(studyStart.getDate() + 1);
    studyStart.setHours(9, 0, 0, 0);
  } else {
    studyStart.setMinutes(0, 0, 0);
    studyStart.setHours(studyStart.getHours() + 1);
  }
  const studyDayOffset = dateKey(studyStart) === dateKey(now) ? 0 : 1;
  const plannedSessions = [
    {
      id: uid(),
      subject_id: math.id,
      topic_id: mathFunctions.id,
      task_id: lateTask?.id ?? null,
      exam_id: null,
      session_date: dateKey(studyStart),
      start_time: timeString(studyStart),
      duration_minutes: 45,
      kind: "estudo",
      priority: 1,
      status: "planejada",
      reason: "Praticar funções do 1º grau",
      generated: true,
    },
    {
      id: uid(),
      subject_id: portuguese.id,
      topic_id: portugueseLanguage.id,
      task_id: upcomingTask?.id ?? null,
      exam_id: null,
      session_date: dateKey(dateAfter(now, studyDayOffset)),
      start_time: "19:00:00",
      duration_minutes: 35,
      kind: "estudo",
      priority: 2,
      status: "planejada",
      reason: "Revisar funções da linguagem",
      generated: false,
    },
    {
      id: uid(),
      subject_id: biology.id,
      topic_id: biologyGenetics.id,
      task_id: null,
      exam_id: null,
      session_date: dateKey(dateAfter(now, -1)),
      start_time: "16:00:00",
      duration_minutes: 50,
      kind: "estudo",
      priority: 2,
      status: "perdida",
      reason: "Retomar genética mendeliana",
      generated: true,
    },
    {
      id: uid(),
      subject_id: biology.id,
      topic_id: biologyGenetics.id,
      task_id: null,
      exam_id: null,
      session_date: dateKey(dateAfter(now, -3)),
      start_time: "15:00:00",
      duration_minutes: 55,
      kind: "estudo",
      priority: 1,
      status: "concluida",
      reason: "Estudo de genética",
      generated: false,
    },
    {
      id: uid(),
      subject_id: history.id,
      topic_id: historyVargas.id,
      task_id: null,
      exam_id: exams[1]?.id ?? null,
      session_date: dateKey(dateAfter(now, 2)),
      start_time: "17:30:00",
      duration_minutes: 40,
      kind: "revisao",
      priority: 2,
      status: "planejada",
      reason: "Preparação para o simulado",
      generated: true,
    },
  ].map((session) => ({
    ...session,
    user_id: userId,
    created_at: createdAt,
    updated_at: updatedAt,
  }));

  const focus = [
    {
      id: uid(),
      subject_id: math.id,
      topic_id: mathFunctions.id,
      plan_session_id: plannedSessions[3]?.id ?? null,
      started_at: dateTime(now, -3, "15:00"),
      ended_at: dateTime(now, -3, "15:55"),
      planned_minutes: 50,
      actual_minutes: 55,
      status: "concluida",
    },
    {
      id: uid(),
      subject_id: portuguese.id,
      topic_id: portugueseLanguage.id,
      plan_session_id: null,
      started_at: dateTime(now, -2, "16:00"),
      ended_at: dateTime(now, -2, "16:40"),
      planned_minutes: 40,
      actual_minutes: 40,
      status: "concluida",
    },
    {
      id: uid(),
      subject_id: biology.id,
      topic_id: biologyGenetics.id,
      plan_session_id: null,
      started_at: dateTime(now, -5, "14:00"),
      ended_at: dateTime(now, -5, "15:05"),
      planned_minutes: 60,
      actual_minutes: 65,
      status: "concluida",
    },
  ].map((session) => ({ ...session, user_id: userId, created_at: createdAt }));

  const reviews = [
    {
      id: uid(),
      topic_id: mathRatio.id,
      due_on: dateKey(now),
      status: "pendente",
      source: "automatico",
      reason: "Domínio baixo (42%) em Razão e proporção",
      completed_at: null,
    },
    {
      id: uid(),
      topic_id: biologyGenetics.id,
      due_on: dateKey(dateAfter(now, 2)),
      status: "pendente",
      source: "automatico",
      reason: "Revisar genética antes da próxima avaliação",
      completed_at: null,
    },
    {
      id: uid(),
      topic_id: topic("Células e organelas")?.id ?? biologyGenetics.id,
      due_on: dateKey(dateAfter(now, -4)),
      status: "concluida",
      source: "automatico",
      reason: "Revisão concluída",
      completed_at: dateTime(now, -4, "17:30"),
    },
  ].map((review) => ({ ...review, user_id: userId, created_at: createdAt }));

  const goals = [
    {
      id: uid(),
      title: "Estudar 8 horas na semana",
      metric: "horas_estudo",
      target: 480,
      period: "semanal",
      subject_id: null,
      active: true,
    },
    {
      id: uid(),
      title: "Concluir 5 tarefas",
      metric: "tarefas",
      target: 5,
      period: "semanal",
      subject_id: null,
      active: true,
    },
  ].map((goal) => ({
    ...goal,
    user_id: userId,
    created_at: createdAt,
    updated_at: updatedAt,
  }));

  const events = [
    {
      id: uid(),
      title: "Revisão guiada — Matemática",
      kind: "evento",
      source: "ordys",
      starts_at: dateTime(now, 1, "18:00"),
      ends_at: dateTime(now, 1, "18:45"),
      location: "Biblioteca",
      subject_id: math.id,
      external_id: null,
    },
    {
      id: uid(),
      title: "Plantão de dúvidas",
      kind: "evento",
      source: "ordys",
      starts_at: dateTime(now, 3, "17:00"),
      ends_at: dateTime(now, 3, "17:40"),
      location: "Sala 12",
      subject_id: math.id,
      external_id: null,
    },
  ].map((event) => ({ ...event, user_id: userId, created_at: createdAt }));

  const checkins = [
    {
      id: uid(),
      checkin_date: dateKey(dateAfter(now, -1)),
      studied_minutes: 85,
      focus_rating: 4,
      completed_plan: "parcial",
      hardest_subject_id: math.id,
      pending_note: "Finalizar a lista de funções.",
    },
    {
      id: uid(),
      checkin_date: dateKey(dateAfter(now, -3)),
      studied_minutes: 110,
      focus_rating: 5,
      completed_plan: "sim",
      hardest_subject_id: biology.id,
      pending_note: null,
    },
  ].map((checkin) => ({ ...checkin, user_id: userId, created_at: createdAt }));

  const quizAttemptId = uid();
  const quizAnswers = [
    {
      topic_id: mathFunctions.id,
      question: "Qual é a raiz da função f(x) = 2x - 6?",
      options: ["1", "2", "3", "6"],
      correct_answer: "3",
      given_answer: "3",
      is_correct: true,
      explanation: "A raiz ocorre quando 2x - 6 = 0, portanto x = 3.",
      seconds_spent: 42,
    },
    {
      topic_id: mathFunctions.id,
      question: "Em uma função afim, o coeficiente angular indica:",
      options: [
        "O ponto onde a reta cruza o eixo y",
        "A inclinação da reta",
        "O valor máximo da função",
        "A raiz da função",
      ],
      correct_answer: "A inclinação da reta",
      given_answer: "A inclinação da reta",
      is_correct: true,
      explanation: "O coeficiente angular determina a inclinação da reta.",
      seconds_spent: 55,
    },
    {
      topic_id: mathRatio.id,
      question: "Se 3 cadernos custam R$ 24, quanto custam 5 cadernos?",
      options: ["R$ 30", "R$ 36", "R$ 40", "R$ 45"],
      correct_answer: "R$ 40",
      given_answer: "R$ 40",
      is_correct: true,
      explanation: "Cada caderno custa R$ 8; cinco custam R$ 40.",
      seconds_spent: 62,
    },
    {
      topic_id: mathFunctions.id,
      question: "Qual é o valor de f(2) para f(x) = 3x + 1?",
      options: ["5", "6", "7", "8"],
      correct_answer: "7",
      given_answer: "6",
      is_correct: false,
      explanation: "Substituindo x por 2: f(2) = 3 · 2 + 1 = 7.",
      seconds_spent: 71,
    },
    {
      topic_id: mathRatio.id,
      question: "Uma razão compara:",
      options: [
        "Duas grandezas por divisão",
        "Duas grandezas por adição",
        "Somente números inteiros",
        "Duas equações",
      ],
      correct_answer: "Duas grandezas por divisão",
      given_answer: "Duas grandezas por divisão",
      is_correct: true,
      explanation:
        "A razão é a comparação entre duas grandezas por meio de uma divisão.",
      seconds_spent: 48,
    },
  ].map((answer) => ({
    ...answer,
    id: uid(),
    user_id: userId,
    attempt_id: quizAttemptId,
    created_at: createdAt,
  }));

  const profile = {
    id: userId,
    full_name: profileName,
    stage: "medio",
    timezone: "America/Sao_Paulo",
    grade_scale_max: 10,
    grade_pass: 6,
    attendance_target: 75,
    weekly_study_target_minutes: 480,
    daily_load_limit_minutes: 240,
    school_name: "Escola Demonstrativa",
    course: null,
    class_name: "2º ano",
    city: null,
    state: null,
    country: "Brasil",
    education_level: "Ensino Médio",
    birth_date: null,
    created_at: createdAt,
    updated_at: updatedAt,
  };

  const quizAttempts = [
    {
      id: quizAttemptId,
      user_id: userId,
      subject_id: math.id,
      difficulty: "media",
      question_count: 5,
      correct_count: 4,
      status: "concluido",
      duration_seconds: 278,
      finished_at: dateTime(now, -2, "16:30"),
      created_at: dateTime(now, -2, "16:25"),
    },
  ];

  return {
    profiles: [profile],
    subjects,
    topics,
    tasks,
    subtasks,
    exams,
    grades,
    attendance_records: attendance,
    subject_schedules: schedules,
    plan_sessions: plannedSessions,
    focus_sessions: focus,
    reviews,
    goals,
    calendar_events: events,
    daily_checkins: checkins,
    quiz_attempts: quizAttempts,
    quiz_answers: quizAnswers,
  };
}
