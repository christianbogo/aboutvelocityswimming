// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductForm from "@/app/(site)/store/[id]/ProductForm";
import { updatesBlocked } from "@/lib/update-safety";

let view: ReturnType<typeof render>;
function submit() {
  return fireEvent.submit(view.container.querySelector("form")!);
}
beforeEach(() => {
  view = render(
    createElement(ProductForm, {
      productId: 1,
      productName: "Team shirt",
      variants: [
        {
          id: 2,
          external_id: "shirt-medium",
          name: "Team shirt - M",
          retail_price: "25",
        },
      ],
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  expect(updatesBlocked()).toBe(false);
});

describe("checkout update safety", () => {
  it("holds updates on native submit, shows pending status, and prevents duplicate submissions", () => {
    expect(updatesBlocked()).toBe(false);
    expect(submit()).toBe(true);
    expect(updatesBlocked()).toBe(true);
    expect(
      (
        screen.getByRole("button", {
          name: "Opening checkout…",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(
      "Opening secure checkout",
    );
    expect(submit()).toBe(false);
  });

  it("offers non-submitting reload recovery while retaining the pending checkout hold", () => {
    submit();
    const recovery = screen.getByRole("button", {
      name: "Reload page",
    }) as HTMLButtonElement;
    expect(recovery.type).toBe("button");
    expect(recovery.disabled).toBe(false);
    expect(screen.getByRole("status").textContent).toContain(
      "Reloading will not submit another checkout",
    );
    const reload = vi.fn();
    // jsdom does not navigate. Mock only that browser side effect while React
    // still renders and dispatches the real DOM button's click.
    vi.stubGlobal("window", new Proxy(window, {
      get: (target, property, receiver) => property === "location"
        ? { reload }
        : Reflect.get(target, property, receiver),
    }));
    fireEvent.click(recovery);
    expect(reload).toHaveBeenCalledOnce();
    expect(updatesBlocked()).toBe(true);
    expect(submit()).toBe(false);
  });

  it("releases the hold and pending state on pageshow so back navigation can retry", () => {
    submit();
    fireEvent(window, new Event("pageshow"));
    expect(updatesBlocked()).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Checkout with Stripe",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(submit()).toBe(true);
    expect(updatesBlocked()).toBe(true);
  });

  it("releases on unmount and removes the pageshow listener", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    submit();
    view.unmount();
    expect(updatesBlocked()).toBe(false);
    expect(remove).toHaveBeenCalledWith("pageshow", expect.any(Function));
    fireEvent(window, new Event("pageshow"));
    expect(updatesBlocked()).toBe(false);
    remove.mockRestore();
  });
});
