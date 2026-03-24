public class Main {
    public static void main(String[] args) {
        Person person1 = new Person("Valeriy");
        Person person2 = new Person("Valeriy", "Shamonin");
        System.out.println(person1.name);
        System.out.println(person2.name + " " + person2.surname);
    }
}