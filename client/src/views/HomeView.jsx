import ViewHeader from '../components/ViewHeader.jsx';
import HomeSpendGoalWidget from '../components/HomeSpendGoalWidget.jsx';

export default function HomeView() {
  return (
    <div>
      <ViewHeader title="Home" subtitle="Overview dashboard" />
      <div className="px-6 py-6">
        <HomeSpendGoalWidget />
      </div>
    </div>
  );
}
