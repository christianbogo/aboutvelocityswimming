import { localSupabase } from "../scripts/local-supabase.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const config = localSupabase();

const make = (key = config.PUBLISHABLE_KEY) =>
  createClient(config.API_URL, key, {
    auth: { persistSession: false },
  });
const admin = make(config.SERVICE_ROLE_KEY);

await test("athlete selections persist atomically and remain private to their account", async () => {
  const users = [];
  try {
    const athletes = await admin
      .from("public_athletes")
      .select("id,data")
      .limit(3);
    assert.ifError(athletes.error);
    assert.equal(athletes.data.length, 3, "Run seed:local before this check.");
    const [first, second, third] = athletes.data.map(({ id }) => id);
    for (let i = 0; i < 2; i++) {
      const email = `athlete-follow-${randomUUID()}@example.test`,
        password = randomUUID();
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      assert.ifError(created.error);
      const client = make();
      users.push({ id: created.data.user.id, client });
      assert.ifError(
        (await client.auth.signInWithPassword({ email, password })).error,
      );
    }
    const [owner, other] = users;
    const save = (client, accountId, primary, favorites) =>
      client.rpc("save_account_athletes", {
        account_user_id: accountId,
        primary_id: primary,
        favorite_ids: favorites,
      });
    const read = async () => {
      const result = await owner.client.rpc("get_account_athletes", {
        account_user_id: owner.id,
      });
      assert.ifError(result.error);
      return result.data;
    };
    const saved = await save(owner.client, owner.id, first, [second, third]);
    assert.ifError(saved.error);
    assert.equal(saved.data.length, 3);
    assert.equal(saved.data.find((row) => row.is_primary).id, first);
    assert.deepEqual(await read(), saved.data);
    const otherRead = await other.client.rpc("get_account_athletes", {
      account_user_id: owner.id,
    });
    assert.ifError(otherRead.error);
    assert.deepEqual(otherRead.data, []);
    assert.ok(
      (await make().rpc("get_account_athletes", { account_user_id: owner.id }))
        .error,
    );
    assert.ok((await save(other.client, owner.id, second, [])).error);
    assert.ok(
      (
        await other.client
          .from("account_followed_athletes")
          .insert({ user_id: owner.id, athlete_id: first })
      ).error,
    );
    await other.client
      .from("account_followed_athletes")
      .delete()
      .eq("user_id", owner.id);
    assert.deepEqual(await read(), saved.data);
    assert.ok(
      (
        await owner.client
          .from("account_followed_athletes")
          .update({ user_id: other.id })
          .eq("user_id", owner.id)
      ).error,
    );
    assert.ok(
      (
        await owner.client
          .from("account_followed_athletes")
          .update({ is_primary: true })
          .eq("user_id", owner.id)
      ).error,
    );
    for (const [primary, favorites] of [
      [first, [first]],
      [first, [second, second]],
      [first, ["not-an-athlete"]],
      ["missing-primary", []],
    ]) {
      assert.ok((await save(owner.client, owner.id, primary, favorites)).error);
      assert.deepEqual(
        await read(),
        saved.data,
        "Rejected save preserves previous choices",
      );
    }
    const fullName = `${athletes.data[0].data.name.first} ${athletes.data[0].data.name.last}`;
    const search = await owner.client.rpc("search_account_athletes", {
      search_text: fullName,
    });
    assert.ifError(search.error);
    assert.ok(search.data.some((row) => row.id === first));
    const literal = await owner.client.rpc("search_account_athletes", {
      search_text: "%' OR 1=1 --",
    });
    assert.ifError(literal.error);
    assert.deepEqual(literal.data, []);
    assert.ifError((await save(owner.client, owner.id, null, [])).error);
    assert.deepEqual(await read(), []);
  } finally {
    for (const user of users) {
      await user.client.auth.signOut();
      await admin.auth.admin.deleteUser(user.id);
    }
  }
});
