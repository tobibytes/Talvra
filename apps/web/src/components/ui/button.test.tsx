import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("defaults to type=button so it never submits forms by accident", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute("type", "button");
  });

  it("fires clicks and respects disabled", () => {
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick}>Go</Button>);
    fireEvent.click(screen.getByRole("button"));
    rerender(
      <Button onClick={onClick} disabled>
        Go
      </Button>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe("Button as a link", () => {
  it("keeps link semantics when rendering an <a>", () => {
    render(<Button render={<a href="/x" />}>Open</Button>);
    const link = screen.getByRole("link", { name: "Open" });
    expect(link).toHaveAttribute("href", "/x");
    expect(link).not.toHaveAttribute("role");
    expect(link).toHaveAttribute("data-slot", "button");
  });
});
