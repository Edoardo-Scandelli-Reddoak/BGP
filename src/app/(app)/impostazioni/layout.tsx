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
        description="Utenti e ruoli, email automatiche, corrieri, dati della bolla e modulo pubblico."
      />
      <SettingsTabs />
      <div className="mt-6 space-y-6">{children}</div>
    </>
  );
}
