import { and, eq } from "drizzle-orm";
import {
  BaseSQLiteDatabase,
  SQLiteTableFn,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";
import { Adapter, AdapterAccount } from "next-auth/adapters";

export function createTables(sqliteTable: SQLiteTableFn) {
  const users = sqliteTable("user", {
    id: text("id").notNull().primaryKey(),
    name: text("name"),
    email: text("email").notNull(),
    emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
    image: text("image"),
  });

  const accounts = sqliteTable(
    "account",
    {
      userId: text("userId")
        .notNull()
        .references(() => users.id, { onDelete: "cascade" }),
      type: text("type").$type<AdapterAccount["type"]>().notNull(),
      provider: text("provider").notNull(),
      providerAccountId: text("providerAccountId").notNull(),
      refresh_token: text("refresh_token"),
      access_token: text("access_token"),
      expires_at: integer("expires_at"),
      token_type: text("token_type"),
      scope: text("scope"),
      id_token: text("id_token"),
      session_state: text("session_state"),
    },
    (account) => ({
      compoundKey: primaryKey(account.provider, account.providerAccountId),
    }),
  );

  const sessions = sqliteTable("session", {
    sessionToken: text("sessionToken").notNull().primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  });

  const verificationTokens = sqliteTable(
    "verificationToken",
    {
      identifier: text("identifier").notNull(),
      token: text("token").notNull(),
      expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
    },
    (vt) => ({
      compoundKey: primaryKey(vt.identifier, vt.token),
    }),
  );

  return { users, accounts, sessions, verificationTokens };
}

export function SQLiteDrizzleAdapter(
  client: InstanceType<typeof BaseSQLiteDatabase>,
  tableFn = sqliteTable,
): Adapter {
  const { users, accounts, sessions, verificationTokens } =
    createTables(tableFn);

  return {
    // @ts-ignore
    createUser(data) {
      return client
        .insert(users)
        .values({ ...data, id: crypto.randomUUID() })
        .returning()
        .get();
    },
    // @ts-ignore
    getUser(data) {
      return (
        client.select().from(users).where(eq(users.id, data)).get() ?? null
      );
    },
    getUserByEmail(data) {
      const res =
        client.select().from(users).where(eq(users.email, data)).get() ?? null;
      return res;
    },
    createSession(data) {
      return client.insert(sessions).values(data).returning().get();
    },
    getSessionAndUser(data) {
      const results = client
        .select({
          session: sessions,
          user: users,
        })
        .from(sessions)
        .where(eq(sessions.sessionToken, data))
        .innerJoin(users, eq(users.id, sessions.userId))
        .get();

      const haber = results.then(d => d)
      console.log("getSessionAndUser", haber);

      if (!results) {
        return null;
      }

      return results;
    },
    updateUser(data) {
      if (!data.id) {
        throw new Error("No user id.");
      }

      return client
        .update(users)
        .set(data)
        .where(eq(users.id, data.id))
        .returning()
        .get();
    },
    updateSession(data) {
      return client
        .update(sessions)
        .set(data)
        .where(eq(sessions.sessionToken, data.sessionToken))
        .returning()
        .get();
    },
    linkAccount(rawAccount) {
      const updatedAccount = client
        .insert(accounts)
        .values(rawAccount)
        .returning()
        .get();

      const account: AdapterAccount = {
        ...updatedAccount,
        type: updatedAccount.type,
        access_token: updatedAccount.access_token ?? undefined,
        token_type: updatedAccount.token_type ?? undefined,
        id_token: updatedAccount.id_token ?? undefined,
        refresh_token: updatedAccount.refresh_token ?? undefined,
        scope: updatedAccount.scope ?? undefined,
        expires_at: updatedAccount.expires_at ?? undefined,
        session_state: updatedAccount.session_state ?? undefined,
      };

      return account;
    },
    getUserByAccount(account) {
      const results = client
        .select()
        .from(accounts)
        .leftJoin(users, eq(users.id, accounts.userId))
        .where(
          and(
            eq(accounts.provider, account.provider),
            eq(accounts.providerAccountId, account.providerAccountId),
          ),
        )
        .get();

      console.log("getUserByAccount", results);

      if (!results) {
        return null;
      }

      return Promise.resolve(results).then((results) => results.user);
    },
    // @ts-ignore
    deleteSession(sessionToken) {
      return (
        client
          .delete(sessions)
          .where(eq(sessions.sessionToken, sessionToken))
          .returning()
          .get() ?? null
      );
    },
    // @ts-ignore
    createVerificationToken(token) {
      return client.insert(verificationTokens).values(token).returning().get();
    },
    // @ts-ignore
    useVerificationToken(token) {
      try {
        return (
          client
            .delete(verificationTokens)
            .where(
              and(
                eq(verificationTokens.identifier, token.identifier),
                eq(verificationTokens.token, token.token),
              ),
            )
            .returning()
            .get() ?? null
        );
      } catch (err) {
        throw new Error("No verification token found.");
      }
    },
    // @ts-ignore
    deleteUser(id) {
      return client.delete(users).where(eq(users.id, id)).returning().get();
    },
    unlinkAccount(account) {
      client
        .delete(accounts)
        .where(
          and(
            eq(accounts.providerAccountId, account.providerAccountId),
            eq(accounts.provider, account.provider),
          ),
        )
        .run();

      return undefined;
    },
  };
}