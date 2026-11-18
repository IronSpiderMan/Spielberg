import { useState, type SetStateAction } from "react";

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function editedFields<T extends object>(saved: T, draft: T): Partial<T> {
  const edits: Partial<T> = {};
  for (const field of Object.keys(draft) as (keyof T)[]) {
    if (!sameValue(saved[field], draft[field])) edits[field] = draft[field];
  }
  return edits;
}

export function useEditorDraft<T extends object>(source: T) {
  const sourceKey = JSON.stringify(source);
  const [state, setState] = useState({ sourceKey, saved: source, draft: source });
  if (state.sourceKey !== sourceKey) {
    // Refresh the saved fields while keeping edits the user has made in the form.
    setState({ sourceKey, saved: source, draft: { ...source, ...editedFields(state.saved, state.draft) } });
  }

  const edit = <K extends keyof T>(field: K, update: SetStateAction<T[K]>) => {
    setState(current => {
      const value = typeof update === "function" ? (update as (value: T[K]) => T[K])(current.draft[field]) : update;
      return sameValue(value, current.draft[field]) ? current : { ...current, draft: { ...current.draft, [field]: value } };
    });
  };

  const markSaved = (sent: Partial<T>, response: T) => {
    setState(current => {
      const saved = { ...current.saved };
      const draft = { ...current.draft };
      for (const field of Object.keys(sent) as (keyof T)[]) {
        saved[field] = response[field];
        if (sameValue(draft[field], sent[field])) draft[field] = response[field];
      }
      return { ...current, saved, draft };
    });
  };

  return { ...state, edit, markSaved };
}
