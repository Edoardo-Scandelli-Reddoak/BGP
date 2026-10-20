import { SettingsTabs } from "@/components/impostazioni/settings-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth/session";

export default async function SettingsLayout({ children }: LayoutProps<"/impostazioni">) {
  await requireUser("settings.manage");
  return (
    <>
      <PageHeader
        eyebrow="Amministrazione"
        title="Impostazioni"
        description="Utenti e ruoli, email automatiche, corrieri, costi per cliente, bolla di consegna, export dei m² per il CRM e modulo pubblico."
      />
      <SettingsTabs />
      <div className="mt-6 space-y-6">{children}</div>
    </>
  );
}
