import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import { AppShell, MantineProvider } from "@mantine/core";
import { RecurringPaymentApp } from "./RecurringPaymentApp";

const App = () => {
	return (
		<>
			<MantineProvider>
				<AppShell>
					<AppShell.Main>
						<RecurringPaymentApp />
					</AppShell.Main>
				</AppShell>
			</MantineProvider>
		</>
	);
};

export default App;
