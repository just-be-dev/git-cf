import { IslandHost } from "@/client/server/IslandHost";
import { AuthAdminIsland } from "@/client/islands/auth-admin";

export function AuthPage() {
  return (
    <IslandHost name="auth-admin" props={{}}>
      <AuthAdminIsland />
    </IslandHost>
  );
}
