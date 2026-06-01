import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { admin } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { prisma } from "./prisma.js";
import type { Context } from "hono";
import { ac, roles } from "./permissions.js";
import { sendPasswordResetEmail } from "./email.js";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    // Password reset configuration
    sendResetPassword: async ({ user, url, token }, request) => {
      console.log(`[Auth] Password reset requested for: ${user.email}`);
      console.log(`[Auth] Reset URL: ${url}`);
      try {
        await sendPasswordResetEmail(user.email, token, url);
        console.log(
          `[Auth] Password reset email sent successfully to: ${user.email}`,
        );
      } catch (error) {
        console.error(`[Auth] Failed to send password reset email:`, error);
        // Don't throw - we don't want to reveal if email exists
      }
    },
  },
  // Social OAuth providers
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      // Always show the Google account chooser (better for shared devices /
      // users with multiple accounts) instead of silently reusing a session.
      prompt: "select_account",
    },
  },
  // Account linking: let a Google login attach to an existing account that has
  // the same email. Google verifies email ownership, so it's a trusted provider
  // and may link automatically — this is what lets existing email/password
  // users (including admins) sign in with Google instead of erroring out.
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
    },
  },
  trustedOrigins: [
    process.env.APP_CLIENT_URL!,
    "http://localhost:5173",
    "https://www.flyarzan.com",
  ],
  advanced: {
    // Use lax for local development (same-site requests)
    // In production with HTTPS, you can use "none" with secure: true
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  },
  user: {
    // Enable account deletion
    deleteUser: {
      enabled: true,
      // Prevent admin accounts from being deleted
      beforeDelete: async (user) => {
        const userWithRole = user as typeof user & { role?: string };
        if (userWithRole.role === "super" || userWithRole.role === "admin") {
          throw new APIError("BAD_REQUEST", {
            message:
              "Admin accounts cannot be deleted. Please contact support.",
          });
        }
      },
    },
  },
  plugins: [
    admin({
      ac,
      roles: {
        super: roles.super,
        admin: roles.admin,
        moderator: roles.moderator,
        user: roles.user,
      },
      defaultRole: "user",
      adminRoles: "super",
    }),
  ],
});

// Get the current user session from request headers
export const getSession = async (c: Context) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session;
};

// Middleware to require authentication
export const requireAuth = async (c: Context, next: () => Promise<void>) => {
  const session = await getSession(c);
  if (!session?.user) {
    return c.json(
      { error: "Unauthorized", message: "Authentication required" },
      401,
    );
  }
  // Store user and session in context for later use
  c.set("user", session.user);
  c.set("session", session.session);
  await next();
};

// Middleware to require specific roles
export const requireRole = (...allowedRoles: string[]) => {
  return async (c: Context, next: () => Promise<void>) => {
    const session = await getSession(c);
    if (!session?.user) {
      return c.json(
        { error: "Unauthorized", message: "Authentication required" },
        401,
      );
    }

    const userRole = session.user.role || "user";

    // Super admin always has access
    if (userRole === "super") {
      c.set("user", session.user);
      c.set("session", session.session);
      await next();
      return;
    }

    if (!allowedRoles.includes(userRole)) {
      return c.json(
        {
          error: "Forbidden",
          message: `Required role: ${allowedRoles.join(" or ")}`,
        },
        403,
      );
    }

    c.set("user", session.user);
    c.set("session", session.session);
    await next();
  };
};

// Middleware to require admin role (super or admin)
export const requireAdmin = requireRole("super", "admin");

// Middleware to require moderator or higher
export const requireModerator = requireRole("super", "admin", "moderator");

// Middleware to require specific permission
export const requirePermission = (resource: string, action: string) => {
  return async (c: Context, next: () => Promise<void>) => {
    const session = await getSession(c);
    if (!session?.user) {
      return c.json(
        { error: "Unauthorized", message: "Authentication required" },
        401,
      );
    }

    const userRole = (session.user.role || "user") as keyof typeof roles;

    // Check if role exists
    const role = roles[userRole];
    if (!role) {
      return c.json({ error: "Forbidden", message: "Invalid role" }, 403);
    }

    // Check permission using better-auth's access control
    // @ts-ignore - accessing role permissions
    const resourcePerms = role.statements?.[resource];
    const hasPermission = resourcePerms?.includes(action);

    if (!hasPermission) {
      return c.json(
        {
          error: "Forbidden",
          message: `Missing permission: ${resource}:${action}`,
        },
        403,
      );
    }

    c.set("user", session.user);
    c.set("session", session.session);
    await next();
  };
};
