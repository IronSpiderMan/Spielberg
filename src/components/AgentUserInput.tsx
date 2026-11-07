import { useState } from "react";
import type { FormEvent } from "react";
import { MessageSquare } from "lucide-react";
import "./agent-user-input.css";

type Option = { id: string; label: string; description?: string };
type Question = { id: string; question: string; type: "confirmation" | "text" | "single_select" | "multi_select"; options?: Option[] };
export type UserInputRequest = { id: string; questions: Question[]; tool?: { name: string; arguments: unknown } };
export type UserInputAnswers = Record<string, boolean | string | string[]>;

// Both Agent surfaces use the same form, validation, and explicit-submit semantics.
export function AgentUserInput({ request, disabled, onSubmit }: {
  request: UserInputRequest; disabled?: boolean; onSubmit: (answers: UserInputAnswers) => Promise<void>;
}) {
  const [answers, setAnswers] = useState<UserInputAnswers>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const locked = disabled || submitting || submitted;
  const valid = request.questions.every(question => {
    const answer = answers[question.id];
    return question.type === "confirmation" ? typeof answer === "boolean"
      : question.type === "multi_select" ? Array.isArray(answer) && answer.length > 0
      : typeof answer === "string" && !!answer.trim();
  });
  const setAnswer = (id: string, value: UserInputAnswers[string]) => setAnswers(previous => ({ ...previous, [id]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (locked || !valid) return;
    setSubmitting(true); setError("");
    try { await onSubmit(answers); setSubmitted(true); }
    catch (error) { setError(String(error)); }
    finally { setSubmitting(false); }
  };
  return <form className="agent-user-input" data-testid="agent-user-input" onSubmit={event => void submit(event)} aria-label="回答 Agent 问题">
    <div className="agent-user-input-heading"><MessageSquare size={16} /><strong>需要你的决定</strong></div>
    {request.tool && <details className="agent-user-input-tool" open><summary>待执行工具 · {request.tool.name}</summary><pre>{JSON.stringify(request.tool.arguments, null, 2)}</pre></details>}
    {request.questions.map((question, index) => <fieldset key={question.id} disabled={locked}>
      <legend>{request.questions.length > 1 && `${index + 1}. `}{question.question}</legend>
      {question.type === "text" ? <textarea aria-label={question.question} value={typeof answers[question.id] === "string" ? answers[question.id] as string : ""} maxLength={4000} rows={3} placeholder="输入补充信息…" onChange={event => setAnswer(question.id, event.target.value)} />
        : question.type === "confirmation" ? <div className="agent-user-input-options">{[{ value: true, label: request.tool ? "允许执行" : "是" }, { value: false, label: request.tool ? "拒绝执行" : "否" }].map(option => <label key={String(option.value)}>
          <input type="radio" name={`${request.id}:${question.id}`} checked={answers[question.id] === option.value} onChange={() => setAnswer(question.id, option.value)} /><span>{option.label}</span>
        </label>)}</div>
          : <div className="agent-user-input-options">{question.options?.map(option => {
            const answer = answers[question.id];
            const multiple = question.type === "multi_select";
            const checked = multiple ? Array.isArray(answer) && answer.includes(option.id) : answer === option.id;
            return <label key={option.id}><input type={multiple ? "checkbox" : "radio"} name={`${request.id}:${question.id}`} checked={checked} onChange={() => {
              if (multiple) { const current = Array.isArray(answer) ? answer : []; setAnswer(question.id, checked ? current.filter(id => id !== option.id) : [...current, option.id]); }
              else setAnswer(question.id, option.id);
            }} /><span>{option.label}{option.description && <small>{option.description}</small>}</span></label>;
          })}</div>}
      {question.type === "multi_select" && <small className="agent-user-input-hint">可选择多项，至少一项</small>}
    </fieldset>)}
    {error && <div className="agent-user-input-error" role="alert">{error}</div>}
    <div className="agent-user-input-actions"><small>{submitted || disabled ? "回答已提交，正在继续…" : "提交后 Agent 将依据你的回答继续"}</small><button type="submit" disabled={locked || !valid}>{submitting ? "正在提交…" : "提交回答"}</button></div>
  </form>;
}
