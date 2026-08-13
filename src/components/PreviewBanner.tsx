import type { PreviewNotice } from "@/lib/assemble";
import { TOPIC_LABELS } from "@/lib/blueprint";

/**
 * The label on a preview paper, shown on every screen that displays one.
 *
 * Two sizes of the same statement rather than two statements: the compact form
 * rides along in the question header where there is no room for the detail, and
 * the full form appears wherever the paper is being summarised. Neither is
 * dismissible, because the thing it is warning about does not go away as the
 * learner gets used to seeing it.
 */

function shortTopics(notice: PreviewNotice): string {
  return notice.under
    .map((row) => `${TOPIC_LABELS[row.topic]} ${row.filled}/${row.requested}`)
    .join(" · ");
}

/** Sections that came up short, which on a real bank is not all of them. */
function shortSections(notice: PreviewNotice) {
  return notice.sections.filter((section) => section.length < section.officialLength);
}

export function PreviewBannerCompact({ notice }: { notice: PreviewNotice }) {
  const short = shortSections(notice);
  return (
    <div className="mt-2 rounded-lg bg-warn-soft px-2.5 py-1.5 text-xs leading-relaxed text-warn">
      <span className="font-semibold uppercase tracking-wide">Preview</span> — not the
      real test. {notice.length} questions instead of {notice.officialLength}, drawn from
      an incomplete bank
      {short.length > 0 && (
        <>
          {" ("}
          {short
            .map((s) => `section ${s.section} has ${s.length} of ${s.officialLength}`)
            .join(", ")}
          {")"}
        </>
      )}
      .
    </div>
  );
}

export function PreviewBannerFull({ notice }: { notice: PreviewNotice }) {
  return (
    <div className="rounded-xl border border-warn/40 bg-warn-soft p-4 text-warn">
      <p className="text-xs font-semibold uppercase tracking-wide">Preview — not the real test</p>
      <p className="mt-1.5 text-sm leading-relaxed">
        This paper was drawn from an incomplete question bank. It has{" "}
        <span className="font-semibold tabular-nums">{notice.length}</span> questions
        where the official paper has{" "}
        <span className="font-semibold tabular-nums">{notice.officialLength}</span>, and
        the topics below could not be filled to their quota. It is not a valid mock of
        the official paper and a score on it says nothing about whether you would pass
        one.
      </p>
      <p className="mt-2 text-xs leading-relaxed">
        <span className="font-semibold">By section:</span>{" "}
        {notice.sections
          .map((s) => `${s.section} ${s.length}/${s.officialLength}`)
          .join(" · ")}
      </p>
      {notice.under.length > 0 && (
        <p className="mt-1 text-xs leading-relaxed">
          {/* "Before padding" is doing real work: rules of the road can appear
              here as 12/15 and still show more than 15 questions in the topic
              breakdown, because the padding went there. What it could not fill
              is the sub-requirement, and that stays true after padding. */}
          <span className="font-semibold">Under quota before padding:</span>{" "}
          {shortTopics(notice)}
        </p>
      )}
      {notice.extra > 0 && (
        <p className="mt-1 text-xs leading-relaxed">
          A further {notice.extra} question{notice.extra === 1 ? " was" : "s were"} added
          from whichever topics had a surplus, so the balance between topics is wrong as
          well as the length. A section is never padded past its real length, so the
          question numbers are the ones the paper prints.
        </p>
      )}
    </div>
  );
}
