import { App as AntApp, ConfigProvider, Layout, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { FundScreenerPage } from "./pages/FundScreener";

export default function App() {
  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: "#0f766e",
          colorInfo: "#0f766e",
          colorSuccess: "#059669",
          colorWarning: "#d97706",
          colorError: "#dc2626",
          borderRadius: 6,
          fontSize: 13,
          fontSizeSM: 12,
          fontSizeLG: 15,
          lineHeight: 1.42,
          controlHeight: 30,
          controlHeightSM: 24,
          controlHeightLG: 34,
          padding: 12,
          paddingSM: 8,
          paddingXS: 6,
          margin: 12,
          marginSM: 8,
          marginXS: 6,
          fontFamily:
            'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Card: {
            borderRadiusLG: 8,
            headerHeight: 40,
            headerHeightSM: 32,
            paddingLG: 14,
            paddingSM: 10,
          },
          Table: {
            cellFontSize: 13,
            cellFontSizeSM: 12,
            cellPaddingBlock: 8,
            cellPaddingBlockSM: 5,
            cellPaddingInline: 10,
            cellPaddingInlineSM: 8,
            headerSplitColor: "#e8edf3",
          },
          Drawer: {
            paddingLG: 16,
          },
        },
      }}
    >
      <AntApp>
        <Layout className="page-shell">
          <Layout.Header className="app-header">
            <div className="brand-lockup">
              <span className="brand-mark">选</span>
              <span>选基宝</span>
            </div>
          </Layout.Header>
          <Layout.Content className="app-content">
            <div className="app-content-inner">
              <FundScreenerPage />
            </div>
          </Layout.Content>
        </Layout>
      </AntApp>
    </ConfigProvider>
  );
}
