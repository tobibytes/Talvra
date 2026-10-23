import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { fakeApi, GOOD_TOKEN, makeMe, renderApp } from "./test-utils";

describe("route guards", () => {
  it("sends signed-out visitors to sign-in and remembers where they were going", async () => {
    fakeApi({ me: null });
    const { router } = await renderApp("/courses");
    await screen.findByRole("heading", { level: 1, name: "Welcome back" });
    expect(router.state.location.pathname).toBe("/sign-in");
    expect(router.state.location.search).toMatchObject({ redirect: "/courses" });
  });

  it("sends signed-in users who haven't finished setup to onboarding", async () => {
    fakeApi({ me: makeMe({ onboarded: false, canvas: null }) });
    const { router } = await renderApp("/");
    await screen.findByRole("heading", { level: 1, name: "Welcome, Oluwatobi" });
    expect(router.state.location.pathname).toBe("/onboarding");
  });

  it("keeps signed-in users away from the sign-in page", async () => {
    fakeApi({ me: makeMe() });
    const { router } = await renderApp("/sign-in");
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });
});

describe("sign in", () => {
  it("shows a clear error for a wrong password", async () => {
    fakeApi({ me: null });
    await renderApp("/sign-in");
    fireEvent.change(await screen.findByLabelText("Morgan email"), {
      target: { value: "olola@morgan.edu" },
    });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "nope nope nope" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That email and password don't match.",
    );
  });

  it("signs in and returns to the page they asked for", async () => {
    fakeApi({ me: null });
    const { router } = await renderApp("/homework");
    fireEvent.change(await screen.findByLabelText("Morgan email"), {
      target: { value: "olola@morgan.edu" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/homework"));
  });

  it("ignores off-site redirect targets", async () => {
    fakeApi({ me: null });
    const { router } = await renderApp("/sign-in?redirect=//evil.com");
    fireEvent.change(await screen.findByLabelText("Morgan email"), {
      target: { value: "olola@morgan.edu" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });
});

describe("sign up", () => {
  it("asks for a Morgan email before calling the server", async () => {
    const api = fakeApi({ me: null });
    await renderApp("/sign-up");
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Tobi" } });
    fireEvent.change(screen.getByLabelText("Morgan email"), {
      target: { value: "tobi@gmail.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("Use your @morgan.edu email.")).toBeInTheDocument();
    expect(
      api.mock.calls.some(([u]) => String(u instanceof Request ? u.url : u).includes("sign-up")),
    ).toBe(false);
  });

  it("sends new accounts to the check-your-email screen", async () => {
    fakeApi({ me: null });
    const { router } = await renderApp("/sign-up");
    fireEvent.change(await screen.findByLabelText("Your name"), { target: { value: "Tobi" } });
    fireEvent.change(screen.getByLabelText("Morgan email"), {
      target: { value: "tobi@morgan.edu" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "correct horse battery" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await screen.findByRole("heading", { name: "Check your email" });
    expect(router.state.location.pathname).toBe("/check-email");
    expect(screen.getByText("tobi@morgan.edu")).toBeInTheDocument();
  });
});

describe("onboarding", () => {
  it("connects Canvas, picks courses, and lands on Today", async () => {
    fakeApi({ me: makeMe({ onboarded: false, canvas: null }) });
    const { router } = await renderApp("/onboarding");

    // A bad token shows the server's message on the field.
    const token = await screen.findByLabelText("Canvas access token");
    fireEvent.change(token, { target: { value: "1234~badbadbadbadbadbadbad" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Canvas" }));
    expect(await screen.findByText(/Canvas didn't accept that token/)).toBeInTheDocument();

    fireEvent.change(token, { target: { value: GOOD_TOKEN } });
    fireEvent.click(screen.getByRole("button", { name: "Connect Canvas" }));
    await screen.findByRole("heading", { name: "Pick your courses" });
    expect(screen.getByText(/Connected as Oluwatobi Olajide/)).toBeInTheDocument();

    // Everything starts selected; untick one.
    expect(await screen.findByText("2 of 2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /MATH 241/ }));
    expect(screen.getByText("1 of 2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await screen.findByRole("heading", { name: "You're all set" });
    // Finishing setup starts the first sync; its progress shows here live.
    expect(await screen.findByText(/Bringing in your course from Canvas/)).toBeInTheDocument();
    expect(screen.getByText("COSC 220 Data Structures")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Sync progress" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Go to Today" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/"));
  });

  it("resumes at course picking when Canvas is already connected", async () => {
    fakeApi({ me: makeMe({ onboarded: false }) });
    await renderApp("/onboarding");
    expect(await screen.findByRole("heading", { name: "Pick your courses" })).toBeInTheDocument();
  });
});

describe("settings", () => {
  it("saves the profile name", async () => {
    fakeApi({ me: makeMe() });
    await renderApp("/settings");
    const name = await screen.findByLabelText("Name");
    fireEvent.change(name, { target: { value: "Tobi Olajide" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
    expect(name).toHaveValue("Tobi Olajide");
  });

  it("shows the Canvas connection without the token and lists sessions", async () => {
    fakeApi({ me: makeMe() });
    await renderApp("/settings");
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("••••good")).toBeInTheDocument();
    expect(await screen.findByText("Chrome on macOS")).toBeInTheDocument();
    expect(screen.getByText("Safari on iOS")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
  });

  it("signs out", async () => {
    fakeApi({ me: makeMe() });
    const { router } = await renderApp("/settings");
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
  });
});
