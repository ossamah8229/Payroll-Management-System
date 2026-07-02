import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { loginSchema, type LoginInput } from '@payroll/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LogoPlaceholder } from '@/components/logo-placeholder';
import { useLogin, useSession } from '@/hooks/use-session';
import { ApiError } from '@/lib/api-client';

export function LoginPage() {
  const { data: sessionUser, isLoading: isSessionLoading } = useSession();
  const login = useLogin();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  if (!isSessionLoading && sessionUser) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(values: LoginInput) {
    try {
      await login.mutateAsync(values);
    } catch (error) {
      const message =
        error instanceof ApiError ? error.message : 'Something went wrong. Please try again.';
      toast(message);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <Card className="w-full max-w-[380px]">
        <CardHeader className="flex-col items-center gap-2 text-center">
          <LogoPlaceholder size="md" />
          <div className="flex flex-col items-center gap-0.5">
            <CardTitle>Payroll Management System</CardTitle>
            <span className="text-xs text-text-muted">Sign in to continue</span>
          </div>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3.5" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                {...register('email')}
                aria-invalid={Boolean(errors.email)}
              />
              {errors.email && <span className="text-[11px] text-danger">{errors.email.message}</span>}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                {...register('password')}
                aria-invalid={Boolean(errors.password)}
              />
              {errors.password && (
                <span className="text-[11px] text-danger">{errors.password.message}</span>
              )}
            </div>

            <Button type="submit" className="mt-1.5 w-full" disabled={login.isPending}>
              {login.isPending ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
