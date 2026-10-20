import type { Metadata } from "next";
import { CompanySettingsForm } from "@/components/impostazioni/general-settings-forms";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Bolla e azienda — Impostazioni" };

export default async function CompanySettingsPage() {
  await requireUser("settings.manage");
  const s = await getSettings();
  return (
    <Card>
      <CardHeader
        title="Bolla di consegna e dati aziendali"
        description="Compaiono nell'intestazione della bolla di consegna generata dal sistema. Causale, porto e aspetto sono i valori proposti per ogni nuova bolla."
      />
      <CardBody>
        <CompanySettingsForm
          values={{
            companyName: s.companyName,
            companyAddress: s.companyAddress,
            companyTaxInfo: s.companyTaxInfo,
            companyContacts: s.companyContacts,
            bollaCausale: s.bollaCausale,
            bollaPorto: s.bollaPorto,
            bollaAspetto: s.bollaAspetto,
          }}
        />
      </CardBody>
    </Card>
  );
}
