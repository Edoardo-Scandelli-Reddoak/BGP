import { describe, expect, it } from "vitest";
import type { Role } from "@/db/schema";
import { roleEnum } from "@/db/schema";
import {
  can,
  canViewRequestInStatus,
  PERMISSIONS,
  ROLE_DESCRIPTIONS,
  ROLE_HOME,
  ROLE_LABELS,
  ROLES,
  type Permission,
} from "@/lib/roles";
import { EDITABLE_IN } from "@/lib/requests/workflow";
import { STATUS_ORDER } from "@/lib/status";

const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];
const permissionsOf = (role: Role) => ALL_PERMISSIONS.filter((p) => can(role, p)).sort();

/** Permessi che modificano dati (tutto tranne la consultazione). */
const EDIT_PERMISSIONS: Permission[] = [
  "requests.manage",
  "warehouse.work",
  "logistics.work",
  "registry.edit",
  "settings.manage",
  "requests.revert",
];

describe("matrice dei permessi", () => {
  it("ROLES coincide con l'enum del database", () => {
    expect([...ROLES].sort()).toEqual([...roleEnum.enumValues].sort());
  });

  it("ogni ruolo ha etichetta, descrizione e pagina iniziale", () => {
    for (const role of ROLES) {
      expect(ROLE_LABELS[role], role).toBeTruthy();
      expect(ROLE_DESCRIPTIONS[role], role).toBeTruthy();
      expect(ROLE_HOME[role], role).toMatch(/^\//);
    }
  });

  it("i permessi citano solo ruoli esistenti", () => {
    for (const [perm, roles] of Object.entries(PERMISSIONS)) {
      for (const role of roles) expect(ROLES, perm).toContain(role);
    }
  });

  it("ADMIN ha tutti i permessi", () => {
    expect(permissionsOf("ADMIN")).toEqual([...ALL_PERMISSIONS].sort());
  });

  it("BACKOFFICE ha tutto tranne le impostazioni", () => {
    expect(permissionsOf("BACKOFFICE")).toEqual(ALL_PERMISSIONS.filter((p) => p !== "settings.manage").sort());
  });

  it("DIREZIONE è in sola lettura", () => {
    for (const p of EDIT_PERMISSIONS) expect(can("DIREZIONE", p), p).toBe(false);
    expect(permissionsOf("DIREZIONE")).toEqual(["management.view", "registry.view", "reports.m2"]);
  });

  it("CRM vede solo il report mensile dei m²", () => {
    expect(permissionsOf("CRM")).toEqual(["reports.m2"]);
  });

  it("MAGAZZINO lavora solo la coda di magazzino e non gestisce le richieste", () => {
    expect(permissionsOf("MAGAZZINO")).toEqual(["warehouse.work"]);
    expect(can("MAGAZZINO", "requests.manage")).toBe(false);
    expect(can("MAGAZZINO", "requests.revert")).toBe(false);
  });

  it("LOGISTICA lavora solo spedizioni e bolle", () => {
    expect(permissionsOf("LOGISTICA")).toEqual(["logistics.work"]);
  });

  it("le impostazioni sono solo dell'amministratore", () => {
    expect(PERMISSIONS["settings.manage"]).toEqual(["ADMIN"]);
  });

  it("senza ruolo nessun permesso", () => {
    for (const p of ALL_PERMISSIONS) {
      expect(can(null, p)).toBe(false);
      expect(can(undefined, p)).toBe(false);
    }
  });
});

describe("pagina iniziale del ruolo", () => {
  /** Permesso richiesto dalle pagine iniziali (requireUser nelle rispettive page.tsx). */
  const HOME_PERMISSION: Record<string, Permission> = {
    "/richieste": "requests.manage",
    "/magazzino": "warehouse.work",
    "/logistica": "logistics.work",
    "/direzione": "management.view",
    "/report/mq": "reports.m2",
  };

  it("ogni ruolo può aprire la propria pagina iniziale (niente redirect in loop)", () => {
    for (const role of ROLES) {
      const home = ROLE_HOME[role];
      const perm = HOME_PERMISSION[home];
      expect(perm, `${role} → ${home}`).toBeDefined();
      expect(can(role, perm), `${role} → ${home}`).toBe(true);
    }
  });
});

describe("canViewRequestInStatus", () => {
  it("ADMIN, BACKOFFICE e DIREZIONE vedono le richieste in ogni stato", () => {
    for (const role of ["ADMIN", "BACKOFFICE", "DIREZIONE"] as Role[]) {
      for (const status of STATUS_ORDER) expect(canViewRequestInStatus(role, status), `${role}/${status}`).toBe(true);
    }
  });

  it("MAGAZZINO vede solo In preparazione e Pronta per il ritiro", () => {
    expect(STATUS_ORDER.filter((s) => canViewRequestInStatus("MAGAZZINO", s))).toEqual(["IN_PREPARAZIONE", "PRONTA_RITIRO"]);
  });

  it("LOGISTICA vede dal ritiro in poi", () => {
    expect(STATUS_ORDER.filter((s) => canViewRequestInStatus("LOGISTICA", s))).toEqual(["PRONTA_RITIRO", "SPEDITA", "COMPLETATA"]);
  });

  it("CRM non apre il dettaglio delle richieste", () => {
    for (const status of STATUS_ORDER) expect(canViewRequestInStatus("CRM", status)).toBe(false);
  });

  it("chi può modificare un gruppo di campi vede la richiesta negli stati in cui è modificabile", () => {
    const groups: [keyof typeof EDITABLE_IN, Permission][] = [
      ["info", "requests.manage"],
      ["items", "requests.manage"],
      ["warehouse", "warehouse.work"],
      ["logistics", "logistics.work"],
    ];
    for (const role of ROLES) {
      for (const [group, perm] of groups) {
        if (!can(role, perm)) continue;
        for (const status of EDITABLE_IN[group]) {
          expect(canViewRequestInStatus(role, status), `${role} ${group} ${status}`).toBe(true);
        }
      }
    }
  });
});
