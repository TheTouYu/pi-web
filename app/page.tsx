import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { I18nProvider } from "@/hooks/useI18n";
import { RoleProvider } from "@/hooks/useRole";

export default function Home() {
  return (
    <Suspense>
      <I18nProvider>
        <RoleProvider>
          <AppShell />
        </RoleProvider>
      </I18nProvider>
    </Suspense>
  );
}
