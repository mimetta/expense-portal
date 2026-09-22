"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Settings > Users & access. Replaces User Management, People & departments
// and the read-only Permissions tab: one record per person, one Save.

const FOREST = "#1F3A2B";
const TERRACOTTA = "#BD5A2E";

interface Scope { bu_scope: string; dept_scope: string; cat_l1_scope: string }
interface Person {
  email: string; bu: "ONEST" | "SV" | "BOTH"; bu_defaulted: boolean;
  visible_departments: string; chapter: string | null;
  roles: string[]; boScopes: Scope[];
  overrides: { menu: string; allowed: boolean }[];
  fy_count: number; duplicateOf: string[];
}
interface Data {
  people: Person[]; departments: string[]; roles: string[];
  workflowMenus: Record<string, string>; freeMenus: string[];
  freeMenuDefaults: Record<string, string[]>;
  catTree: Record<string, Record<string, string[]>>; fiscalYear: number;
}

const MENU_LABEL: Record<string, string> = {
  "bo-approvals": "BO Approvals", "ceo-approvals": "CEO Approvals", accounting: "Accounting",
  procurement: "Procurement", "petty-cash": "Petty Cash",
  "spend-report": "Spend report", budget: "Budget",
  "settings.suppliers": "Settings · Suppliers", "settings.products": "Settings · Products",
  "settings.categories": "Settings · Categories", "settings.companies": "Settings · Companies",
  "settings.deptconfig": "Settings · Signature rules", "settings.announcements": "Settings · Announcements",
  "settings.pettycash": "Settings · Petty cash custodians",
  "settings.users": "Settings · Users & access", "settings.people": "Settings · Users & access (people)",
  "settings.permissions": "Settings · Users & access (permissions)",
};
const FILTERS = ["All", "Unassigned", "BU defaulted", "BO", "EMPLOYEE", "Overrides"];
const split = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

function Flag({ tone, children }: { tone: "warn" | "bad"; children: React.ReactNode }) {
  const s = tone === "warn" ? { background: "#FBF2EC", color: TERRACOTTA } : { background: "#FBF0EE", color: "#B23A2F" };
  return <span className="rounded-full px-[7px] py-[1px] text-[10px] font-medium" style={s}>{children}</span>;
}
const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div><div className="mm-section-label">{title}</div>{children}</div>
);
const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick} className="rounded-full px-3 py-1 text-[12.5px]"
    style={on ? { background: FOREST, color: "#fff", border: `1px solid ${FOREST}` }
              : { background: "#fff", color: "#1A1A1A", border: "1px solid #D8CBB0" }}>{children}</button>
);

export default function UsersAccessTab() {
  const [data, setData] = useState<Data | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("All");
  const [openEmail, setOpenEmail] = useState<string | null>(null);
  const [draft, setDraft] = useState<Person | null>(null);
  const [menuDraft, setMenuDraft] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const [newEmail, setNewEmail] = useState("");

  const load = async () => {
    const res = await fetch("/api/users-access");
    const d = await res.json();
    if (!res.ok) { setError(d.error || "Could not load"); return; }
    setData(d);
  };
  useEffect(() => { void load(); }, []);

  const defaultFor = (p: Person, menu: string): boolean => {
    if (p.roles.includes("SUPERADMIN")) return true;
    const wf = data?.workflowMenus[menu];
    if (wf) return p.roles.includes(wf);
    return (data?.freeMenuDefaults[menu] ?? []).some((r) => p.roles.includes(r));
  };

  const open = (p: Person) => {
    setOpenEmail(p.email);
    setDraft(JSON.parse(JSON.stringify(p)));
    const m: Record<string, boolean> = {};
    for (const menu of data?.freeMenus ?? []) {
      const o = p.overrides.find((x) => x.menu === menu);
      m[menu] = o ? o.allowed : defaultFor(p, menu);
    }
    setMenuDraft(m); setError(null); setNotice(null);
  };

  // Role edits move the defaults under the toggles. Anything not explicitly
  // overridden follows the new default rather than freezing at the old one.
  const roleKey = draft?.roles.slice().sort().join(",") ?? "";
  useEffect(() => {
    if (!draft || !data) return;
    setMenuDraft((prev) => {
      const next = { ...prev };
      for (const menu of data.freeMenus) {
        const explicit = draft.overrides.some((o) => o.menu === menu && o.allowed === prev[menu]);
        if (!explicit) next[menu] = defaultFor(draft, menu);
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleKey]);

  const save = async (confirmDropBo = false): Promise<void> => {
    if (!draft) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const res = await fetch("/api/users-access", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: draft.email, roles: draft.roles, bu: draft.bu,
          visible_departments: split(draft.visible_departments),
          boScopes: draft.roles.includes("BO") ? draft.boScopes : [],
          menus: menuDraft, confirmDropBo,
        }),
      });
      const d = await res.json();
      if (res.status === 409 && d.needsConfirmation === "dropBo") {
        const list = (d.revisions ?? []).map((r: { fiscal_year: number; revision_no: number; status: string }) =>
          `FY${r.fiscal_year} rev ${r.revision_no} (${r.status})`).join(", ");
        setBusy(false);
        if (confirm(`${d.message}\n\n${list}\n\nRemove BO anyway?`)) return save(true);
        return;
      }
      if (!res.ok) throw new Error(d.error || "Could not save");
      setNotice("Saved.");
      await load(); setOpenEmail(null); setDraft(null);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const addPerson = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/users-access", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim().toLowerCase() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Could not add");
      setAdding(false); setNewEmail(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  // Below the side-by-side breakpoint the card stacks under the list, so
  // bring it into view rather than leaving the click looking inert — which
  // is exactly how this page failed before.
  useEffect(() => {
    if (!openEmail || !cardRef.current) return;
    const r = cardRef.current.getBoundingClientRect();
    if (r.top < 0 || r.top > window.innerHeight - 120) {
      cardRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [openEmail]);

  const visible = useMemo(() => {
    if (!data) return [];
    return data.people.filter((p) => {
      if (q && !p.email.toLowerCase().includes(q.toLowerCase())) return false;
      if (filter === "Unassigned") return split(p.visible_departments).length === 0;
      if (filter === "BU defaulted") return p.bu_defaulted;
      if (filter === "BO") return p.roles.includes("BO");
      if (filter === "EMPLOYEE") return p.roles.includes("EMPLOYEE");
      if (filter === "Overrides") return p.overrides.length > 0;
      return true;
    });
  }, [data, q, filter]);

  if (!data) return <p className="text-sm text-brand-muted">Loading people…</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[12px] text-brand-muted">
          {visible.length} of {data.people.length} people · FY{data.fiscalYear} request counts
        </p>
        <button className="mm-btn-primary mm-btn-sm" onClick={() => setAdding(true)}>+ Add person</button>
      </div>

      {error && <div className="rounded-[10px] px-4 py-3 text-sm" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#DC2626", whiteSpace: "pre-wrap" }}>{error}</div>}
      {notice && <div className="rounded-[10px] px-4 py-2 text-[13px]" style={{ background: "#F0F4EF", border: "1px solid #9CAE8C", color: FOREST }}>{notice}</div>}

      {/* Mockup layout: a narrow sticky list beside the card, so the card is
          always next to the person being edited. It previously sat BELOW all
          38 rows — ~2,200px below the fold — so clicking Edit flipped the
          button to "Close" and appeared to do nothing. */}
      <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[320px_1fr]">
        <div className="mm-table-wrap md:sticky md:top-3">
          <div className="space-y-2 border-b border-brand-border p-3" style={{ background: "#FDFCFA" }}>
            <input className="mm-input w-full" placeholder="Search by email" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button key={f} onClick={() => setFilter(f)} className="rounded-full px-2.5 py-1 text-[11.5px]"
                  style={filter === f ? { background: FOREST, color: "#fff", border: `1px solid ${FOREST}` }
                                      : { background: "#fff", color: "#6B7280", border: "1px solid #D8CBB0" }}>{f}</button>
              ))}
            </div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {visible.map((p) => {
              const d = split(p.visible_departments);
              const on = openEmail === p.email;
              return (
                <button
                  key={p.email}
                  onClick={() => (on ? (setOpenEmail(null), setDraft(null)) : open(p))}
                  className="block w-full border-b border-brand-border px-3 py-2 text-left last:border-b-0 hover:bg-[#FAFAF7]"
                  style={on ? { background: "#FFFBEB", boxShadow: `inset 3px 0 0 ${FOREST}` } : undefined}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] text-brand-dark">{p.email}</span>
                    {p.overrides.length > 0 && <span title={`${p.overrides.length} menu override(s)`}
                      style={{ width: 6, height: 6, borderRadius: 99, background: TERRACOTTA, flex: "none" }} />}
                    <span className="ml-auto shrink-0 tabular-nums text-[11px] text-brand-subtle">{p.fy_count}</span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-brand-muted">
                    {p.roles.slice().sort().join(", ") || "no roles"} · {p.bu}
                    {d.length > 0 && ` · ${d.join(", ")}`}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {d.length === 0 && <Flag tone="warn">no department</Flag>}
                    {p.bu_defaulted && <Flag tone="warn">BU defaulted</Flag>}
                    {p.duplicateOf.length > 0 && <Flag tone="bad">possible duplicate</Flag>}
                  </div>
                </button>
              );
            })}
            {visible.length === 0 && <p className="px-3 py-6 text-center text-[13px] text-brand-muted">No people match.</p>}
          </div>
        </div>

        <div ref={cardRef} className="scroll-mt-3">
          {draft && openEmail ? (
            <PersonCard
              draft={draft} setDraft={setDraft} data={data}
              menuDraft={menuDraft} setMenuDraft={setMenuDraft} defaultFor={defaultFor}
              busy={busy} onSave={() => void save()}
              onCancel={() => { setOpenEmail(null); setDraft(null); }}
            />
          ) : (
            <div className="mm-card">
              <p className="py-16 text-center text-[13px] text-brand-muted">
                Choose a person on the left to edit their roles, business unit, spending
                visibility, budget ownership and menu access.
              </p>
            </div>
          )}
        </div>
      </div>

      {adding && (
        <div className="mm-modal-overlay" style={{ backdropFilter: "blur(2px)" }} onClick={() => setAdding(false)}>
          <div className="mm-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="mm-modal-header"><h2 className="mm-modal-title">Add person</h2></div>
            <div className="mm-modal-body">
              <label className="mm-label mb-1 block">Email</label>
              <input className="mm-input w-full" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="name@mimetta.co" />
              <p className="mt-2 text-[12px] text-brand-muted">
                Created with EMPLOYEE, business unit ONEST and flagged as defaulted, so it gets confirmed rather than inherited.
              </p>
            </div>
            <div className="mm-modal-footer">
              <button className="mm-btn-secondary" onClick={() => setAdding(false)} disabled={busy}>Cancel</button>
              <button className="mm-btn-primary" onClick={() => void addPerson()} disabled={busy || !newEmail.includes("@")}>Add</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PersonCard({
  draft, setDraft, data, menuDraft, setMenuDraft, defaultFor, busy, onSave, onCancel,
}: {
  draft: Person; setDraft: (p: Person) => void; data: Data;
  menuDraft: Record<string, boolean>; setMenuDraft: (m: Record<string, boolean>) => void;
  defaultFor: (p: Person, menu: string) => boolean;
  busy: boolean; onSave: () => void; onCancel: () => void;
}) {
  const depts = split(draft.visible_departments);
  const setScope = (i: number, patch: Partial<Scope>) =>
    setDraft({ ...draft, boScopes: draft.boScopes.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <div className="mm-card space-y-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-brand-dark">{draft.email}</h3>
        <div className="flex shrink-0 gap-2">
          <button className="mm-btn-secondary mm-btn-sm" onClick={onCancel} disabled={busy}>Discard</button>
          <button className="mm-btn-primary mm-btn-sm" onClick={onSave} disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </div>

      <Section title="Roles">
        <div className="flex flex-wrap gap-1.5">
          {data.roles.map((r) => (
            <Chip key={r} on={draft.roles.includes(r)}
              onClick={() => setDraft({ ...draft, roles: draft.roles.includes(r) ? draft.roles.filter((x) => x !== r) : [...draft.roles, r] })}>{r}</Chip>
          ))}
        </div>
      </Section>

      <Section title="Business unit">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["ONEST", "SV", "BOTH"] as const).map((b) => (
            <Chip key={b} on={draft.bu === b} onClick={() => setDraft({ ...draft, bu: b })}>{b === "BOTH" ? "Both" : b}</Chip>
          ))}
          {draft.bu_defaulted && <Flag tone="warn">BU defaulted — saving confirms it</Flag>}
        </div>
        {draft.bu === "BOTH" && (
          <p className="mt-2 text-[12px] text-brand-muted">
            Chooses ONEST or SV on each request. Changing it clears the categories already picked.
          </p>
        )}
      </Section>

      <Section title="Can see spending for">
        <div className="flex flex-wrap gap-1.5">
          {data.departments.map((d) => (
            <Chip key={d} on={depts.includes(d)}
              onClick={() => setDraft({ ...draft, visible_departments: (depts.includes(d) ? depts.filter((x) => x !== d) : [...depts, d]).join(",") })}>{d}</Chip>
          ))}
        </div>
        {depts.length === 0 && <p className="mt-2 text-[12px]" style={{ color: TERRACOTTA }}>Nothing selected — sees nothing in the spend report.</p>}
      </Section>

      {draft.roles.includes("BO") && (
        <Section title="Budget ownership">
          <div className="space-y-2">
            {draft.boScopes.map((s, i) => {
              const deptOptions = Object.keys(data.catTree[s.bu_scope] ?? {}).sort();
              const catOptions = data.catTree[s.bu_scope]?.[s.dept_scope] ?? [];
              const chosen = s.cat_l1_scope === "*" ? [] : split(s.cat_l1_scope);
              return (
                <div key={i} className="rounded-[8px] border border-brand-border p-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <select className="mm-input w-[110px]" value={s.bu_scope}
                      onChange={(e) => setScope(i, { bu_scope: e.target.value, dept_scope: "*", cat_l1_scope: "*" })}>
                      <option value="*">Both BUs</option><option value="ONEST">ONEST</option><option value="SV">SV</option>
                    </select>
                    <select className="mm-input w-[220px]" value={s.dept_scope}
                      onChange={(e) => setScope(i, { dept_scope: e.target.value, cat_l1_scope: "*" })}>
                      <option value="*">All departments</option>
                      {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <button className="mm-btn-secondary mm-btn-sm"
                      onClick={() => setDraft({ ...draft, boScopes: draft.boScopes.filter((_, j) => j !== i) })}>Remove</button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Chip on={s.cat_l1_scope === "*"} onClick={() => setScope(i, { cat_l1_scope: "*" })}>All categories</Chip>
                    {catOptions.map((c) => (
                      <Chip key={c} on={chosen.includes(c)} onClick={() => {
                        const next = chosen.includes(c) ? chosen.filter((x) => x !== c) : [...chosen, c];
                        setScope(i, { cat_l1_scope: next.length ? next.join(",") : "*" });
                      }}>{c}</Chip>
                    ))}
                    {s.dept_scope !== "*" && catOptions.length === 0 && (
                      <span className="text-[12px] text-brand-subtle">No categories recorded for this department.</span>
                    )}
                  </div>
                </div>
              );
            })}
            <button className="rounded-[5px] border border-dashed border-brand-border px-2 py-1 text-[11px] text-brand-muted hover:border-brand-accent hover:text-brand-accent"
              onClick={() => setDraft({ ...draft, boScopes: [...draft.boScopes, { bu_scope: "*", dept_scope: "*", cat_l1_scope: "*" }] })}>+ Add scope row</button>
          </div>
        </Section>
      )}

      <Section title="Menu access">
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {Object.entries(data.workflowMenus).map(([menu, role]) => {
            const on = draft.roles.includes(role) || draft.roles.includes("SUPERADMIN");
            return (
              <div key={menu} className="flex items-center justify-between py-1 text-[13px]">
                <span className={on ? "text-brand-dark" : "text-brand-subtle"}>{MENU_LABEL[menu] ?? menu}</span>
                <span className="text-[11px] text-brand-subtle">{on ? `via ${role}` : `needs ${role}`}</span>
              </div>
            );
          })}
          {data.freeMenus.map((menu) => {
            const dflt = defaultFor(draft, menu);
            const val = menuDraft[menu] ?? dflt;
            const isOverride = val !== dflt;
            return (
              <div key={menu} className="flex items-center justify-between py-1 text-[13px]">
                <span style={isOverride ? { color: TERRACOTTA, fontWeight: 500 } : undefined}>{MENU_LABEL[menu] ?? menu}</span>
                <span className="flex items-center gap-2">
                  {isOverride && <button className="text-[11px] underline" style={{ color: TERRACOTTA }}
                    onClick={() => setMenuDraft({ ...menuDraft, [menu]: dflt })}>reset</button>}
                  <input type="checkbox" checked={val} onChange={(e) => setMenuDraft({ ...menuDraft, [menu]: e.target.checked })} />
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-brand-subtle">
          Workflow menus follow the role and cannot be ticked separately. A toggle differing from the
          role default is an override, shown in terracotta; reset removes it.
        </p>
      </Section>
    </div>
  );
}
