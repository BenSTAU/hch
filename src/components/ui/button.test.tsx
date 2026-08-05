import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("expose son libellé sous le rôle button", () => {
    render(<Button>Réserver</Button>);

    expect(
      screen.getByRole("button", { name: "Réserver" }),
    ).toBeInTheDocument();
  });

  it("déclenche onClick au clic", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Réserver</Button>);

    await user.click(screen.getByRole("button", { name: "Réserver" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("ne déclenche rien lorsqu'il est désactivé", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Réserver
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Réserver" }));

    expect(onClick).not.toHaveBeenCalled();
  });
});
