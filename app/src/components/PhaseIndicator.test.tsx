// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PhaseIndicator } from "./PhaseIndicator";

describe("PhaseIndicator", () => {
  it("idle 状态显示等待开始", () => {
    render(<PhaseIndicator currentPhase="idle" completedPhases={[]} />);
    expect(screen.getByText("等待开始")).toBeInTheDocument();
  });

  it("retry 状态显示重试模式", () => {
    render(<PhaseIndicator currentPhase="retry" completedPhases={[]} />);
    expect(screen.getByText("重试模式")).toBeInTheDocument();
  });

  it("当前阶段高亮并可点击", () => {
    const onClick = vi.fn();
    render(
      <PhaseIndicator
        currentPhase="analyze"
        completedPhases={["explore"]}
        onPhaseClick={onClick}
      />
    );
    expect(screen.getByText("分析")).toBeInTheDocument();
    fireEvent.click(screen.getByText("分析"));
    expect(onClick).toHaveBeenCalledWith("analyze");
  });
});
