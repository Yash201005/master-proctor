import { render, screen } from "@testing-library/react";
import { it, expect } from "vitest";
import App from "../App";
it("renders login form", () => { render(<App />); expect(screen.getByLabelText("Username")).toBeInTheDocument(); expect(screen.getByText("Sign in")).toBeInTheDocument(); });
