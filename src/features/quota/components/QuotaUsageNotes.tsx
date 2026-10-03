import { useTranslation } from 'react-i18next';
import type { QuotaUsageMeta } from '@/types';
import { useNow } from '@/hooks/useNow';
import { describeUsageNotes, formatUsageNoteTime } from '../usageNote';

type QuotaUsageNotesProps = {
  usage: QuotaUsageMeta | undefined;
  /** Muted note styling (cooldown, deferred refresh, ancillary warning). */
  noteClassName: string;
  /** Existing error styling for the last refresh error. */
  errorClassName: string;
};

/** Cooldown, last-error/warning and deferred-refresh notes for a usage-cache card. */
export function QuotaUsageNotes({ usage, noteClassName, errorClassName }: QuotaUsageNotesProps) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const notes = describeUsageNotes(usage, now);
  if (notes.length === 0) return null;
  const time = (ms: number) => formatUsageNoteTime(ms, i18n.resolvedLanguage);
  return (
    <>
      {notes.map((note) =>
        note.kind === 'error' ? (
          <span key={note.kind} role="alert" className={errorClassName}>
            {t('credential_usage.last_error', { message: note.message })}
          </span>
        ) : (
          <span key={note.kind} role="status" className={noteClassName}>
            {note.kind === 'warning'
              ? t('credential_usage.last_warning', { message: note.message })
              : note.kind === 'cooldown'
                ? t('credential_usage.cooldown_note', { time: time(note.atMs) })
                : t('credential_usage.deferred_note', { time: time(note.atMs) })}
          </span>
        )
      )}
    </>
  );
}
