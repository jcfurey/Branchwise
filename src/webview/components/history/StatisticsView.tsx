import { useState } from "preact/hooks";

import type { Contributor, Statistics, StatisticsQuery } from "@/backend/types";
import { Checkbox } from "@/webview/components/ui/Checkbox";
import { Select } from "@/webview/components/ui/Select";
import { emptyFilter, setHistoryFilter } from "@/webview/lib/navigation";
import { hiddenRemotes, showRemoteBranch } from "@/webview/lib/stores";
import { branchPatternScope, visibleBranchList } from "@/webview/lib/stores/hidden-branches.store";
import { useRepositoryQuery } from "@/webview/lib/use-repository-query";
import { getWebviewConfig } from "@/webview/lib/webview-config";
import { getFullDate } from "@/webview/utils/date";
import { initials } from "@/webview/utils/initials";

import { QueryStatus } from "./QueryControls";

/** Weeks in the activity grid: a year, ending with the current week. */
const WEEKS = 53;
const CELL = 11;
const GAP = 2;
const STEP = CELL + GAP;
/** Room on the left for the weekday names and above for the month names. */
const LEFT = 28;
const TOP = 16;
const RIGHT = 24;
/** The fewest weeks between two month names, so that they never overlap. */
const MONTH_GAP = 3;

/** One hue for every level, mixed into the editor background so it works in any theme. */
const HUE = "var(--vscode-charts-green, #3fb950)";
const LEVELS = [0, 30, 55, 78, 100];

/** The level of a day with `count` commits, 0 to 4, against the busiest day's count. */
export function activityLevel(count: number, busiest: number) {
  if (count <= 0 || busiest <= 0) {
    return 0;
  }
  return Math.min(4, Math.ceil((count / busiest) * 4));
}

function levelColour(level: number) {
  return level === 0
    ? "var(--color-btn-hover)"
    : `color-mix(in srgb, ${HUE} ${LEVELS[level]}%, var(--color-editor))`;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** A local calendar day as Git's short dates write it. */
export function dayKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export { initials };

function format(template: string, ...values: Array<string | number>) {
  return values.reduce<string>(
    (text, value, index) => text.replaceAll(`{${index}}`, () => String(value)),
    template
  );
}

/**
 * Commits per day over the last year, a column per week as on a calendar. Each day names its
 * date and count when pointed at.
 */
function ActivityGrid({ activity }: { activity: Record<string, number> }) {
  const l10n = window.l10n;
  const { locale } = getWebviewConfig();
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  // The grid starts on the Sunday WEEKS - 1 weeks before this week's.
  const start = new Date(today);
  start.setDate(today.getDate() - today.getDay() - (WEEKS - 1) * 7);
  const busiest = Math.max(0, ...Object.values(activity));
  const month = new Intl.DateTimeFormat(locale, { month: "short" });
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short" });
  const longDay = new Intl.DateTimeFormat(locale, { dateStyle: "long" });

  const cells = [];
  const starts: Array<{ week: number; date: Date }> = [];
  let total = 0;
  for (let week = 0; week < WEEKS; week++) {
    for (let day = 0; day < 7; day++) {
      const date = new Date(start);
      date.setDate(start.getDate() + week * 7 + day);
      if (date > today) {
        break;
      }
      if (date.getDate() === 1 || (week === 0 && day === 0)) {
        starts.push({ week, date: new Date(date) });
      }
      const count = activity[dayKey(date)] ?? 0;
      total += count;
      cells.push(
        <rect
          key={`${week}-${day}`}
          data-day={dayKey(date)}
          data-count={count}
          x={LEFT + week * STEP}
          y={TOP + day * STEP}
          width={CELL}
          height={CELL}
          rx={2}
          fill={levelColour(activityLevel(count, busiest))}
        >
          <title>
            {format(count === 1 ? l10n.statsDayCommit : l10n.statsDayCommits, count)} ·{" "}
            {longDay.format(date)}
          </title>
        </rect>
      );
    }
  }
  // A month is named above the week it starts in, when the name fits before the next one; the
  // grid's first, partial month gives way to a month starting within three weeks.
  const months = [];
  let named = -Infinity;
  for (const [index, monthStart] of starts.entries()) {
    const next = starts[index + 1];
    if (
      monthStart.week - named < MONTH_GAP ||
      (next !== undefined && next.week - monthStart.week < MONTH_GAP)
    ) {
      continue;
    }
    named = monthStart.week;
    months.push(
      <text key={monthStart.week} x={LEFT + monthStart.week * STEP} y={TOP - 5} class="fill-muted">
        {month.format(monthStart.date)}
      </text>
    );
  }
  // Room on the right for the last month's name.
  const width = LEFT + WEEKS * STEP + RIGHT;
  const height = TOP + 7 * STEP;
  const sunday = new Date(start);
  return (
    <figure class="space-y-2">
      <figcaption class="font-semibold">{l10n.statsActivity}</figcaption>
      <div class="overflow-x-auto">
        <svg
          role="img"
          aria-label={format(l10n.statsActivitySummary, total)}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          class="text-[10px]"
        >
          {months}
          {[1, 3, 5].map((day) => {
            const date = new Date(sunday);
            date.setDate(sunday.getDate() + day);
            return (
              <text key={day} x={0} y={TOP + day * STEP + CELL - 2} class="fill-muted">
                {weekday.format(date)}
              </text>
            );
          })}
          {cells}
        </svg>
      </div>
      <div class="flex items-center gap-1 text-xs text-muted" aria-hidden="true">
        <span class="mr-1">{l10n.statsLess}</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            class="inline-block size-[11px] rounded-[2px]"
            style={{ background: levelColour(level) }}
          />
        ))}
        <span class="ml-1">{l10n.statsMore}</span>
      </div>
    </figure>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div class="min-w-32 rounded border border-line-soft px-3 py-2">
      <div class="text-xs text-muted">{label}</div>
      <div data-statistic={label} class="text-lg font-semibold">
        {value}
      </div>
    </div>
  );
}

function Contributors({ statistics }: { statistics: Statistics }) {
  const l10n = window.l10n;
  const { locale } = getWebviewConfig();
  const number = new Intl.NumberFormat(locale);
  const most = statistics.contributors[0]?.commits ?? 0;
  const share = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const head = "px-3 py-1.5 text-left font-semibold";
  const cell = "px-3 py-1.5";
  return (
    <div class="overflow-x-auto">
      <table class="w-full border-collapse">
        <caption class="sr-only">{l10n.statsContributors}</caption>
        <thead class="border-b border-line">
          <tr>
            <th class={head}>{l10n.statsContributor}</th>
            <th class={`${head} text-right`}>{l10n.statsCommits}</th>
            <th class={head}>
              <span class="sr-only">{l10n.statsShare}</span>
            </th>
            {statistics.lines && <th class={`${head} text-right`}>{l10n.statsLines}</th>}
            <th class={head}>{l10n.statsFirst}</th>
            <th class={head}>{l10n.statsLast}</th>
          </tr>
        </thead>
        <tbody>
          {statistics.contributors.map((person: Contributor) => (
            <tr key={person.email + person.name} class="border-b border-line-soft">
              <td class={cell}>
                <button
                  type="button"
                  data-contributor={person.email}
                  title={format(l10n.statsShowCommits, person.name)}
                  class="flex cursor-pointer items-center gap-2 rounded-sm text-left hover:underline focus:outline-1 focus:outline-focus"
                  onClick={() => setHistoryFilter({ ...emptyFilter(), author: person.email })}
                >
                  <span
                    aria-hidden="true"
                    class="grid size-7 shrink-0 place-items-center rounded-full bg-btn-hover text-xs font-semibold"
                  >
                    {initials(person.name)}
                  </span>
                  <span class="min-w-0">
                    <span class="block truncate">{person.name}</span>
                    <span class="block truncate text-xs text-muted">{person.email}</span>
                  </span>
                </button>
              </td>
              <td class={`${cell} text-right tabular-nums`}>{number.format(person.commits)}</td>
              <td class={`${cell} w-1/4 min-w-24`}>
                <div class="flex items-center gap-2">
                  <div class="h-1.5 flex-1 rounded-full bg-btn">
                    <div
                      class="h-1.5 rounded-full"
                      style={{
                        width: `${most === 0 ? 0 : (person.commits / most) * 100}%`,
                        background: HUE
                      }}
                    />
                  </div>
                  <span class="w-12 text-right text-xs text-muted tabular-nums">
                    {share.format(
                      statistics.commits === 0 ? 0 : person.commits / statistics.commits
                    )}
                  </span>
                </div>
              </td>
              {statistics.lines && (
                <td class={`${cell} text-right whitespace-nowrap tabular-nums`}>
                  <span class="text-git-added">+{number.format(person.added ?? 0)}</span>{" "}
                  <span class="text-git-deleted">−{number.format(person.deleted ?? 0)}</span>
                </td>
              )}
              <td class={`${cell} whitespace-nowrap text-muted`} title={getFullDate(person.first)}>
                {new Date(person.first * 1000).toLocaleDateString(locale)}
              </td>
              <td class={`${cell} whitespace-nowrap text-muted`} title={getFullDate(person.last)}>
                {new Date(person.last * 1000).toLocaleDateString(locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Who has committed, how much, and when: totals, a year of daily activity and every
 * contributor, for every branch or one, over a chosen period.
 */
export function StatisticsView() {
  const l10n = window.l10n;
  const [branch, setBranch] = useState("");
  const [range, setRange] = useState<StatisticsQuery["range"]>("365");
  const [lines, setLines] = useState(false);
  const query = useRepositoryQuery<"statistics">({
    kind: "statistics",
    branch,
    range,
    lines,
    showRemoteBranches: showRemoteBranch.value,
    hiddenRemotes: hiddenRemotes.value,
    ...branchPatternScope()
  });
  const statistics = query.data?.statistics ?? null;
  const { locale } = getWebviewConfig();
  const number = new Intl.NumberFormat(locale);
  const localBranches = (visibleBranchList.value ?? []).filter(
    (name) => !name.startsWith("remotes/")
  );

  return (
    <main data-statistics-view class="space-y-4 p-3 text-ui">
      <div class="flex flex-wrap items-center gap-2">
        <div class="w-48">
          <Select
            aria-label={l10n.statsBranch}
            value={branch}
            onChange={setBranch}
            options={[
              { label: l10n.showAll, value: "" },
              ...localBranches.map((name) => ({ label: name, value: `refs/heads/${name}` }))
            ]}
          />
        </div>
        <div class="w-44">
          <Select
            aria-label={l10n.statsPeriod}
            value={range}
            onChange={(value) => setRange(value as StatisticsQuery["range"])}
            options={[
              { label: l10n.statsLast30Days, value: "30" },
              { label: l10n.statsLast90Days, value: "90" },
              { label: l10n.statsLastYear, value: "365" },
              { label: l10n.statsAllTime, value: "all" }
            ]}
          />
        </div>
        <Checkbox
          label={l10n.statsCountLines}
          checked={lines}
          onInput={(event) => setLines(event.currentTarget.checked)}
        />
      </div>
      <QueryStatus loading={query.loading} error={query.error} />
      {statistics !== null &&
        (statistics.commits === 0 ? (
          <p class="text-muted">{l10n.statsNoCommits}</p>
        ) : (
          <>
            <div class="flex flex-wrap gap-2">
              <Figure label={l10n.statsCommits} value={number.format(statistics.commits)} />
              <Figure
                label={l10n.statsContributors}
                value={number.format(statistics.contributors.length)}
              />
              <Figure label={l10n.statsActiveDays} value={number.format(statistics.activeDays)} />
              {statistics.first !== null && (
                <Figure
                  label={l10n.statsFirst}
                  value={new Date(statistics.first * 1000).toLocaleDateString(locale)}
                />
              )}
            </div>
            <ActivityGrid activity={statistics.activity} />
            <section class="space-y-2">
              <h2 class="font-semibold">{l10n.statsContributors}</h2>
              <Contributors statistics={statistics} />
            </section>
          </>
        ))}
    </main>
  );
}
